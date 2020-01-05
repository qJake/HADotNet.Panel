var HAMessageType;
(function (HAMessageType) {
    HAMessageType["Auth"] = "auth";
    HAMessageType["AuthRequired"] = "auth_required";
    HAMessageType["AuthOK"] = "auth_ok";
    HAMessageType["AuthInvalid"] = "auth_invalid";
    HAMessageType["GetStates"] = "get_states";
    HAMessageType["StateChanged"] = "state_changed";
    HAMessageType["SubscribeToEvents"] = "subscribe_events";
    HAMessageType["Result"] = "result";
    HAMessageType["Event"] = "event";
    HAMessageType["Ping"] = "ping";
    HAMessageType["Pong"] = "pong";
})(HAMessageType || (HAMessageType = {}));
var HAErrorType;
(function (HAErrorType) {
    HAErrorType["IDReuse"] = "id_reuse";
})(HAErrorType || (HAErrorType = {}));
var HAEventType;
(function (HAEventType) {
    HAEventType["StateChanged"] = "state_changed";
})(HAEventType || (HAEventType = {}));
var HAResponseType;
(function (HAResponseType) {
    HAResponseType[HAResponseType["StateList"] = 0] = "StateList";
})(HAResponseType || (HAResponseType = {}));
/// <reference path="typings/reconnecting-websocket.d.ts" />
/// <reference path="models/home-assistant-ws.ts" />
/** Defines the current state of the HA connection. */
var HAConnectionState;
(function (HAConnectionState) {
    HAConnectionState[HAConnectionState["Closed"] = 0] = "Closed";
    HAConnectionState[HAConnectionState["Opening"] = 1] = "Opening";
    HAConnectionState[HAConnectionState["Auth"] = 2] = "Auth";
    HAConnectionState[HAConnectionState["Open"] = 3] = "Open";
})(HAConnectionState || (HAConnectionState = {}));
class ConnectionEvent {
    constructor() {
        this.handlers = [];
    }
    on(handler) {
        this.handlers.push(handler);
    }
    off(handler) {
        this.handlers = this.handlers.filter(h => h !== handler);
    }
    invoke(data) {
        this.handlers.slice(0).forEach(h => h(data));
    }
    event() {
        return this;
    }
}
class HAConnection {
    constructor(targetInstance) {
        this.targetInstance = targetInstance;
        this.PING_INTERVAL = 30 * 1000; // 30 seconds
        this.evStateChanged = new ConnectionEvent();
        this.expectedResults = {};
        this.state = HAConnectionState.Closed;
    }
    // Events
    get OnStateChanged() { return this.evStateChanged.event(); }
    initialize() {
        this.state = HAConnectionState.Opening;
        this.msgId = 1;
        if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
            this.ws = new ReconnectingWebSocket(this.parseSocketUrl(this.targetInstance), null, { automaticOpen: false });
        }
        this.ws.addEventListener('open', () => this.handleOpen());
        this.ws.addEventListener('close', () => this.handleClose());
        this.ws.addEventListener('message', e => this.handleMessage(e));
        this.ws.open();
    }
    refreshAllStates() {
        this.sendStateRequest();
    }
    handleMessage(e) {
        let msg = JSON.parse(e.data);
        if (this.isHAMessage(msg)) {
            console.debug('-> RCV:' + msg.type, msg);
            switch (msg.type) {
                case HAMessageType.AuthRequired:
                    this.sendAuth();
                    return;
                case HAMessageType.AuthOK:
                    this.isReady();
                    return;
                case HAMessageType.Result:
                    let res = msg;
                    if (res.success) {
                        if (this.handleHaExpectedResult(res)) {
                            delete this.expectedResults[res.id];
                        }
                        else {
                            console.info('HA result OK', res);
                        }
                    }
                    else {
                        this.handleHaError(res.error);
                    }
                    return;
                case HAMessageType.Event:
                    this.handleHaEvent(msg);
                    return;
                case HAMessageType.AuthInvalid:
                    console.error('Unable to authenticate with Home Assistant API. Check settings.');
                    this.ws.maxReconnectAttempts = 1; // Don't retry - nothing is going to change. They need to refresh the page.
                    this.ws.close();
                    return;
            }
        }
        else {
            console.warn('-> RCV', e.data);
        }
    }
    isReady() {
        this.state = HAConnectionState.Open;
        // Set up ping
        this.pingInterval = window.setInterval(() => this.sendPing(), this.PING_INTERVAL);
        // Set up state change subscription
        this.sendEventSubscriptionRequest(HAEventType.StateChanged);
    }
    handleHaEvent(msg) {
        if (this.isHAEventStateChanged(msg.event)) {
            this.eventStateChanged(msg.event);
        }
        // else if (isOther(...)) { ... }
    }
    handleHaExpectedResult(msg) {
        let er = this.expectedResults[msg.id];
        if (typeof er !== 'undefined') {
            switch (er) {
                case HAResponseType.StateList:
                    this.resultStateList(msg.result);
                    break;
                default:
                    console.warn('Unhandled response type for this message.', msg);
            }
            return true;
        }
        return false;
    }
    resultStateList(states) {
        for (let s of states) {
            this.evStateChanged.invoke({
                data: {
                    entity_id: s.entity_id,
                    new_state: s,
                    old_state: null
                },
                event_type: HAEventType.StateChanged,
                origin: null,
                time_fired: null
            });
        }
    }
    eventStateChanged(ev) {
        var _a, _b;
        console.info(`HA State Changed [${ev.data.entity_id}] ${(_b = (_a = ev.data.old_state) === null || _a === void 0 ? void 0 : _a.state, (_b !== null && _b !== void 0 ? _b : '<NULL>'))} -> ${ev.data.new_state.state}`);
        this.evStateChanged.invoke(ev);
    }
    sendAuth() {
        this.send({
            type: HAMessageType.Auth,
            access_token: window.ccOptions.token
        });
    }
    sendStateRequest() {
        let responseId = this.send({ type: HAMessageType.GetStates });
        this.expectedResults[responseId] = HAResponseType.StateList;
    }
    sendEventSubscriptionRequest(type) {
        this.send({
            type: HAMessageType.SubscribeToEvents,
            event_type: type
        });
    }
    handleHaError(err) {
        console.error('HA API Error [' + err.code + '] ' + err.message);
    }
    sendPing() {
        this.send({
            type: HAMessageType.Ping
        });
    }
    send(data) {
        console.debug('<- SND:' + data.type, data);
        if (this.state !== HAConnectionState.Closed && this.state !== HAConnectionState.Opening) {
            if (this.state === HAConnectionState.Open) {
                // Set message ID only if connection is open, and auth was previously successful
                data.id = this.msgId++;
            }
            this.ws.send(JSON.stringify(data));
            return data.id;
        }
        else {
            console.warn('Tried to send socket message, but connection isn\'t ready.', data);
            return -1;
        }
    }
    handleOpen() {
        this.state = HAConnectionState.Auth;
    }
    handleClose() {
        this.state = HAConnectionState.Closed;
        if (this.pingInterval) {
            window.clearInterval(this.pingInterval);
            this.pingInterval = 0;
        }
    }
    parseSocketUrl(baseUrl) {
        let aTag = document.createElement('a');
        aTag.href = baseUrl;
        return `${(aTag.protocol.toLowerCase() === 'https:' ? 'wss' : 'ws')}://${aTag.host}/api/websocket`;
    }
    isHAMessage(msg) {
        return msg && typeof msg.type === 'string';
    }
    isHAEventStateChanged(msg) {
        return msg && typeof msg.event_type === 'string' && msg.event_type === HAEventType.StateChanged;
    }
}
/// <reference path="entityState.ts" />
var PageMode;
(function (PageMode) {
    PageMode[PageMode["User"] = 0] = "User";
    PageMode[PageMode["Admin"] = 1] = "Admin";
})(PageMode || (PageMode = {}));
/**
 * A general utility class for miscellaneous helper functions.
 */
class Utils {
    /**
     * Introduces a delay in a promise chain.
     * @param duration The duration, in ms, of the desired delay.
     * @param args Any args to pass on through to the next promise in the chain.
     */
    static delayPromise(duration, ...args) {
        return new Promise(resolve => setTimeout(() => resolve(args), duration));
    }
    /**
     * Resolves various icon options to display the correct one.
     * @param defaultIcon The icon defined in Home Assistant.
     * @param overrideIcon The user's override icon choice.
     */
    static resolveIcon(defaultIcon, overrideIcon) {
        if (overrideIcon && overrideIcon.length) {
            return overrideIcon;
        }
        if (defaultIcon && defaultIcon.length && /^mdi:/i.test(defaultIcon)) {
            return defaultIcon.replace('mdi:', '');
        }
        return '';
    }
    /**
     * Preloads an image and notifies when done via a promise.
     * @param src The image URL to load.
     */
    static preloadImage(src) {
        return new Promise((resolve, reject) => {
            let img = new Image();
            img.onload = () => resolve(src);
            img.onerror = e => reject(e);
            img.src = src;
        });
    }
    /**
     * Converts a degree number to a compass's cardinal direction.
     * @param deg The degrees to convert.
     */
    static convertDegreesToCardinal(deg) {
        return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][(Math.floor((deg / 22.5) + 0.5) % 16)];
    }
    /**
     * Converts a cardinal direction to an arrow icon.
     * @param dir The direction to convert.
     */
    static convertCardinalToIcon(dir) {
        return {
            N: 'arrow-up-thick',
            NNE: 'arrow-up-thick',
            NE: 'arrow-top-right-thick',
            ENE: 'arrow-right-thick',
            E: 'arrow-right-thick',
            ESE: 'arrow-right-thick',
            SE: 'arrow-bottom-right-thick',
            SSE: 'arrow-down-thick',
            S: 'arrow-down-thick',
            SSW: 'arrow-down-thick',
            SW: 'arrow-bottom-left-thick',
            WSW: 'arrow-left-thick',
            W: 'arrow-left-thick',
            WNW: 'arrow-left-thick',
            NW: 'arrow-top-left-thick',
            NNW: 'arrow-up-thick'
        }[dir];
    }
}
/// <reference path="../../../node_modules/@aspnet/signalr/dist/esm/index.d.ts" />
/// <reference path="../utils.ts" />
class Tile {
    constructor(page, name, conn, canLoad = true) {
        var _a;
        this.page = page;
        this.name = name;
        this.conn = conn;
        this.canLoad = canLoad;
        this.el = $(`.tiles .tile[data-tile-name="${name}"]`);
        this.entityId = (_a = this.el.data('tile-entityid')) === null || _a === void 0 ? void 0 : _a.toString();
        if (canLoad) {
            this.el.click(() => {
                this.onClick()
                    .then(() => Utils.delayPromise(500))
                    .then(() => {
                    this.requestState(1000);
                });
            });
        }
        conn.on('SendSystemConfig', (tname, cfg) => {
            if (name == tname) {
                this.config = cfg;
                // New config = re-request state
                if (this.canLoad) {
                    this.requestState();
                }
            }
        });
        conn.on('SendTile', t => {
            if (name == t.name) {
                console.debug(`Received: "SendTile" for tile: ${t.name}`);
                this.updateTileState(t);
            }
        });
        conn.on('SendTileState', (t, s) => {
            if (name == t.name) {
                console.debug(`Received: "SendTileState" for tile: ${t.name}`);
                this.updateState(t, s);
            }
        });
        conn.on('SendTileStates', (t, s) => {
            if (name == t.name) {
                console.debug(`Received: "SendTileStates" for tile: ${t.name}`);
                this.updateStates(t, s);
            }
        });
        conn.on('SendCalendarInfo', (t, s, e) => {
            if (name == t.name) {
                console.debug(`Received: "SendCalendarInfo" for tile: ${t.name}`);
                this.updateCalendar(t, s, e);
            }
        });
        conn.on('SendWarning', msg => console.warn(msg));
        conn.on('SendDateTime', (tile, d, t) => {
            if (name == tile.name) {
                console.debug(`Received: "SendDateTime" for tile: ${tile.name}`);
                this.updateState(tile, d, t);
            }
        });
        if (this.canLoad) {
            this.requestState();
        }
    }
    onClick() {
        return this.conn.invoke("OnTileClicked", this.page, this.name);
    }
    updateTileState(tile, ...args) {
        this.disableLoading();
    }
    updateState(tile, ...args) {
        this.disableLoading();
    }
    updateStates(tile, ...args) {
        this.disableLoading();
    }
    updateCalendar(tile, ...args) {
        this.disableLoading();
    }
    requestState(debounce) {
        this.enableLoading(debounce);
        console.debug(`Sending: "RequestTileState" for tile: ${this.name}`);
        this.conn.invoke('RequestTileState', this.page, this.name);
    }
    requestConfig() {
        this.conn.invoke('RequestConfig', this.name);
    }
    enableLoading(debounce) {
        if (this.el.hasClass("tile-loading") || this.loadingDebouncer) {
            return;
        }
        if (!debounce && !this.debounceTimeMs) {
            this.el.addClass("tile-loading");
        }
        else {
            this.loadingDebouncer = window.setTimeout(() => {
                this.el.addClass("tile-loading");
            }, debounce || this.debounceTimeMs);
        }
    }
    disableLoading() {
        if (this.loadingDebouncer) {
            window.clearTimeout(this.loadingDebouncer);
        }
        this.loadingDebouncer = null;
        this.el.removeClass("tile-loading");
    }
    getEntityId() {
        return this.entityId;
    }
}
/// <reference path="tile.ts" />
class BlankTile extends Tile {
    constructor(page, name, conn) {
        super(page, name, conn, false);
    }
}
/// <reference path="tile.ts" />
class LabelTile extends Tile {
    constructor(page, name, conn) {
        super(page, name, conn, false);
    }
}
/// <reference path="tile.ts" />
class DateTile extends Tile {
    updateState(tile, date, time) {
        $(`#tile-${tile.name}`).find('span[value-date]').text(date);
        $(`#tile-${tile.name}`).find('span[value-time]').text(time);
        super.updateState();
        setTimeout(() => {
            this.requestState(9500);
        }, 10000);
    }
}
/// <reference path="tile.ts" />
class StateTile extends Tile {
    updateState(tile, state) {
        //console.log("State received for: " + tile.name, state);
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        let value = state.state;
        if (state.attributes["unit_of_measurement"]) {
            value += state.attributes["unit_of_measurement"].toString();
        }
        $(`#tile-${tile.name}`).find('span[value-state]').text(value);
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(1000);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class LightTile extends Tile {
    updateState(tile, state) {
        var lightTile = tile;
        //console.log("State received for: " + tile.name, state);
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        $(`#tile-${tile.name}`).find('span[value-icon]')
            .removeClass(`mdi-${lightTile.displayIcon} mdi-${lightTile.displayOffIcon}`)
            .addClass(`mdi mdi-${state.state.toLowerCase() === "on" ? Utils.resolveIcon(state.attributes["icon"], lightTile.displayIcon) : Utils.resolveIcon(state.attributes["icon"], lightTile.displayOffIcon || lightTile.displayIcon)}`);
        // TODO: Add custom on/off state keywords
        $(`#tile-${tile.name}`)
            .find('span[value-icon]')
            .removeClass("state-off state-on")
            .addClass(state.state.toLowerCase() === "on" ? "state-on" : "state-off");
        if (lightTile.onColor && state.state.toLowerCase() === "on") {
            $(`#tile-${tile.name} .value`).css('color', lightTile.onColor);
        }
        if (lightTile.offColor && state.state.toLowerCase() !== "on") {
            $(`#tile-${tile.name} .value`).css('color', lightTile.offColor);
        }
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(2000);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class SwitchTile extends Tile {
    updateState(tile, state) {
        var lightTile = tile;
        //console.log("State received for: " + tile.name, state);
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        $(`#tile-${tile.name}`).find('span[value-icon]')
            .removeClass(`mdi-${lightTile.displayIcon} mdi-${lightTile.displayOffIcon}`)
            .addClass(`mdi mdi-${state.state.toLowerCase() === "on" ? Utils.resolveIcon(state.attributes["icon"], lightTile.displayIcon) : Utils.resolveIcon(state.attributes["icon"], lightTile.displayOffIcon || lightTile.displayIcon)}`);
        // TODO: Add custom on/off state keywords
        $(`#tile-${tile.name}`)
            .find('span[value-icon]')
            .removeClass("state-off state-on")
            .addClass(state.state.toLowerCase() === "on" ? "state-on" : "state-off");
        if (lightTile.onColor && state.state.toLowerCase() === "on") {
            $(`#tile-${tile.name} .value`).css('color', lightTile.onColor);
        }
        if (lightTile.offColor && state.state.toLowerCase() !== "on") {
            $(`#tile-${tile.name} .value`).css('color', lightTile.offColor);
        }
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(2000);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class PersonTile extends Tile {
    updateState(tile, state) {
        //console.log("State received for: " + tile.name, state);
        let picture = state.attributes['entity_picture'] ? state.attributes['entity_picture'].toString() : '';
        let location = state.state.replace('_', ' ');
        let label = state.attributes['friendly_name'].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        let isHome = location.toLowerCase() === 'home';
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        $(`#tile-${tile.name}`).find('span[value-location]').text(location);
        $(`#tile-${tile.name}`).find('span[value-picture]').css('background-image', `url(${picture})`).removeClass('bw');
        if (!isHome) {
            $(`#tile-${tile.name}`).find('span[value-picture]').addClass('bw');
        }
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(2000);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
/// <reference path="../models/skycons.d.ts" />
class WeatherTile extends Tile {
    constructor(page, name, conn, canLoad = true) {
        super(page, name, conn, canLoad);
        this.page = page;
        this.name = name;
        this.conn = conn;
        this.canLoad = canLoad;
        this.iconEl = this.el.find('.condition-icon')[0];
        const fontColor = document.defaultView.getComputedStyle(this.el[0]).color;
        this.skycons = new Skycons({ color: fontColor, resizeClear: true });
        this.skycons.add(this.iconEl, Skycons.CLEAR_DAY);
    }
    updateStates(tile, states) {
        // Some are combination variables
        let windSpeed = '';
        let windDir = '';
        let hi = '';
        let lo = '';
        for (let state in states) {
            let value = states[state] == null ? null : states[state].state;
            switch (state) {
                case WeatherTileEntities.entityId:
                    if (states[state].attributes["unit_of_measurement"]) {
                        value += states[state].attributes["unit_of_measurement"].toString();
                    }
                    $(`#tile-${tile.name}`).find('span[value-temp]').text(value);
                    break;
                case WeatherTileEntities.highTempEntity:
                    if (states[state].attributes["unit_of_measurement"]) {
                        value += states[state].attributes["unit_of_measurement"].toString();
                    }
                    hi = `<i class="mdi mdi-arrow-up-thick"></i> ${value}`;
                    break;
                case WeatherTileEntities.lowTempEntity:
                    if (states[state].attributes["unit_of_measurement"]) {
                        value += states[state].attributes["unit_of_measurement"].toString();
                    }
                    lo = `<i class="mdi mdi-arrow-down-thick"></i> ${value}`;
                    break;
                case WeatherTileEntities.summaryEntity:
                    $(`#tile-${tile.name}`).find('span[value-summary]').text(value);
                    break;
                case WeatherTileEntities.precipChanceEntity:
                    if (states[state].attributes["unit_of_measurement"]) {
                        value += states[state].attributes["unit_of_measurement"].toString();
                    }
                    $(`#tile-${tile.name}`).find('span[value-rain]').text(`Rain: ${value}`);
                    break;
                case WeatherTileEntities.windSpeedEntity:
                    if (states[state].attributes["unit_of_measurement"]) {
                        value += states[state].attributes["unit_of_measurement"].toString();
                    }
                    windSpeed = value;
                    break;
                case WeatherTileEntities.windDirectionEntity:
                    windDir = Utils.convertDegreesToCardinal(parseInt(value));
                    windDir = `<i class="mdi mdi-${Utils.convertCardinalToIcon(windDir)}"></i> ${windDir}`;
                    break;
                case WeatherTileEntities.iconEntity:
                    if (value) {
                        this.skycons.set(this.iconEl, value);
                        this.skycons.play();
                    }
                    else {
                        this.skycons.remove(this.iconEl);
                        $(this.iconEl).hide();
                    }
                    break;
            }
        }
        // Update the compound values
        $(`#tile-${tile.name}`).find('span[value-hi-lo]').html(`${(hi && lo ? hi + ' / ' + lo : hi + lo)}`);
        $(`#tile-${tile.name}`).find('span[value-wind]').html(`Wind: ${(windSpeed + ' ' + windDir).trim()}`);
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(2000);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class CameraTile extends Tile {
    constructor(page, name, conn) {
        super(page, name, conn, true);
        // Kind of a hack/workaround since it's not easy to control the order (requestTileState comes before requestConfig so it's missing the first time around).
        this.firstLoadIgnored = false;
        this.requestConfig();
    }
    updateState(tile, state) {
        var cameraTile = tile;
        if (!this.config || !this.config.baseUrl) {
            if (this.firstLoadIgnored) {
                console.warn("Missing config.baseUrl, unable to render camera display.", this.config);
            }
            else {
                this.firstLoadIgnored = true;
            }
            this.queueTileRefresh(tile);
        }
        else {
            const cacheBuster = Math.floor(Math.random() * Math.floor(99999999));
            let imageUrl = this.config.baseUrl + state.attributes["entity_picture"].toString() + "&_nocache=" + cacheBuster;
            Utils.preloadImage(imageUrl)
                .then(img => {
                let imageSize = cameraTile.imageCropMode.toLowerCase() === 'cover' || cameraTile.imageCropMode.toLowerCase() === 'contain'
                    ? cameraTile.imageCropMode.toLowerCase()
                    : '100% 100%';
                let imagePosition = cameraTile.imageCropMode.toLowerCase() === 'cover' || cameraTile.imageCropMode.toLowerCase() === 'contain'
                    ? '50% 50%'
                    : '0 0';
                $(`#tile-${tile.name}`).css({
                    backgroundImage: `url('${img}')`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: imagePosition,
                    backgroundSize: imageSize
                });
            })
                .finally(() => this.queueTileRefresh(tile, true));
        }
    }
    queueTileRefresh(tile, clearLoading) {
        if (clearLoading) {
            super.updateState();
        }
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState((tile.refreshRate * 1000) - 100);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class SceneTile extends Tile {
    updateState(tile, state) {
        var sceneTile = tile;
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        $(`#tile-${tile.name}`).find('span[value-icon]').addClass(`mdi mdi-${sceneTile.displayIcon || 'filmstrip'}`);
        $(`#tile-${tile.name} .value`).css('color', sceneTile.iconColor);
        super.updateState();
    }
}
/// <reference path="tile.ts" />
class MediaTile extends Tile {
    constructor(page, name, conn) {
        super(page, name, conn, true);
        // Kind of a hack/workaround since it's not easy to control the order (requestTileState comes before requestConfig so it's missing the first time around).
        this.firstLoadIgnored = false;
        this.requestConfig();
    }
    updateState(tile, state) {
        var mediaTile = tile;
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).toggleClass('media-idle', state.attributes['media_title'] === 'Nothing playing' || ((state.state == 'paused' || state.state == 'idle') && !state.attributes["entity_picture"]));
        $(`#tile-${tile.name}`).find('span[value-name]').text(mediaTile.showLabel ? label : '');
        $(`#tile-${tile.name}`).find('span[value-title]').text(mediaTile.showTitle && state.attributes['media_title'] && state.attributes['media_title'] !== 'Nothing playing' ? state.attributes['media_title'].toString() : '');
        if (!this.config || !this.config.baseUrl) {
            if (this.firstLoadIgnored) {
                console.warn("Missing config.baseUrl, unable to render media display.", this.config);
            }
            else {
                this.firstLoadIgnored = true;
            }
            this.queueTileRefresh(tile);
        }
        else {
            if (!state.attributes["entity_picture"]) {
                this.queueTileRefresh(tile, true);
                return;
            }
            const cacheBuster = Math.floor(Math.random() * Math.floor(99999999));
            let imageUrl = this.config.baseUrl + state.attributes["entity_picture"].toString() + "&_nocache=" + cacheBuster;
            Utils.preloadImage(imageUrl)
                .then(img => {
                let imageSize = mediaTile.imageCropMode.toLowerCase() === 'cover' || mediaTile.imageCropMode.toLowerCase() === 'contain'
                    ? mediaTile.imageCropMode.toLowerCase()
                    : '100% 100%';
                let imagePosition = mediaTile.imageCropMode.toLowerCase() === 'cover' || mediaTile.imageCropMode.toLowerCase() === 'contain'
                    ? '50% 50%'
                    : '0 0';
                $(`#tile-${tile.name}`).css({
                    backgroundImage: `url('${img}')`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: imagePosition,
                    backgroundSize: imageSize
                });
            })
                .finally(() => this.queueTileRefresh(tile, true));
        }
    }
    queueTileRefresh(tile, clearLoading) {
        if (clearLoading) {
            super.updateState();
        }
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState((tile.refreshRate * 1000) - 100);
            }, tile.refreshRate * 1000);
        }
    }
}
/// <reference path="tile.ts" />
class NavigationTile extends Tile {
    updateTileState(tile) {
        this.navTile = tile;
        $(`#tile-${tile.name}`).find('span[value-name]').text(this.navTile.label);
        $(`#tile-${tile.name}`).find('span[value-icon]').addClass(`mdi mdi-${this.navTile.displayIcon}`);
        super.updateState();
    }
    onClick() {
        switch (this.navTile.mode.toLowerCase().trim()) {
            case 'home':
                window.location.href = '/d/';
                return;
            case 'refresh':
                window.location.reload();
                return;
            case 'nav':
                window.location.href = `/d/${this.navTile.target}`;
                return;
        }
    }
}
/// <reference path="tile.ts" />
/// <reference path="../models/eventData.ts" />
/// <reference path="../typings/moment.d.ts" />
class CalendarTile extends Tile {
    constructor(page, name, conn) {
        super(page, name, conn, true);
        this.eventContainer = $(`#tile-${name} div.calendar-events`);
    }
    updateCalendar(tile, state, events) {
        let label = state.attributes["friendly_name"].toString();
        if (tile.overrideLabel) {
            label = tile.overrideLabel;
        }
        $(`#tile-${tile.name}`).find('span[value-name]').text(label);
        this.refreshEvents(events);
        super.updateState();
        if (tile.refreshRate > 0) {
            setTimeout(() => {
                this.requestState(1000);
            }, tile.refreshRate * 1000);
        }
    }
    refreshEvents(events) {
        this.eventContainer.empty();
        if (!events.length) {
            this.eventContainer.append('<span class="no-events">No events!</span>');
        }
        else {
            let lastGroup = '';
            for (let i = 0; i < events.length; i++) {
                const evt = events[i];
                const thisGroup = this.getEventHeader(evt);
                if (lastGroup != thisGroup) {
                    // Write header
                    this.eventContainer.append(`<h3>${thisGroup}</h3>`);
                    lastGroup = thisGroup;
                }
                this.eventContainer.append(`<p><span class="summary">${evt.summary}</span><span class="time">${moment(evt.start.dateTime).format('LT')}</span></p>`);
            }
        }
    }
    getEventHeader(event) {
        const today = moment();
        const tomorrow = moment().add(1, 'day');
        let todayHeader = this.formatHeader(today);
        let tomorrowHeader = this.formatHeader(tomorrow);
        const mt = moment(event.start.dateTime);
        let header = this.formatHeader(mt);
        if (header === todayHeader) {
            header += ' (Today)';
        }
        else if (header === tomorrowHeader) {
            header += ' (Tomorrow)';
        }
        return header;
    }
    formatHeader(mt) {
        return mt.format('ddd') + ', ' + mt.format('ll');
    }
}
/// <reference path="tile.ts" />
/// <reference path="blank.tile.ts" />
/// <reference path="label.tile.ts" />
/// <reference path="date.tile.ts" />
/// <reference path="state.tile.ts" />
/// <reference path="light.tile.ts" />
/// <reference path="switch.tile.ts" />
/// <reference path="person.tile.ts" />
/// <reference path="weather.tile.ts" />
/// <reference path="camera.tile.ts" />
/// <reference path="scene.tile.ts" />
/// <reference path="media.tile.ts" />
/// <reference path="navigation.tile.ts" />
/// <reference path="calendar.tile.ts" />
class TileMap {
}
TileMap.ClassMap = {
    'Blank': BlankTile,
    'Label': LabelTile,
    'Date': DateTile,
    'State': StateTile,
    'Light': LightTile,
    'Switch': SwitchTile,
    'Person': PersonTile,
    'Weather': WeatherTile,
    'Camera': CameraTile,
    'Scene': SceneTile,
    'Media': MediaTile,
    'Navigation': NavigationTile,
    'Calendar': CalendarTile
};
/// <reference path="models/models.ts" />
/// <reference path="typings/window-options.d.ts" />
/// <reference path="typings/draggabilly.d.ts" />
/// <reference path="typings/packery.d.ts" />
/// <reference path="typings/packery.jquery.d.ts" />
/// <reference path="../../node_modules/@aspnet/signalr/dist/esm/index.d.ts" />
/// <reference path="tiles/tilemap.ts" />
class CommandCenter {
    constructor() {
        this.tiles = [];
        $(() => this.init());
    }
    init() {
        window.ccOptions.mode == PageMode.Admin
            ? this.initAdmin()
            : this.initUser();
        this.initializeMdiPreview();
        this.initializeColorPreview();
    }
    initAdmin() {
        $(window).on('beforeunload', e => {
            if (this.pageIsDirty && $(e.target.activeElement).prop('type') !== 'submit') {
                return 'You have unsaved changes. Are you sure you want to leave?';
            }
        });
        $('#importTheme, #importConfig').click(() => {
            if (confirm('WARNING: This will OVERWRITE your current settings. Export first if you want to save what you have now! Continue?')) {
                $('#importBrowser').click();
            }
        });
        $('#importBrowser').change(() => {
            $('#importForm').submit();
        });
        $('#resetConfig').click(e => {
            if (!confirm("WARNING: This will COMPLETELY RESET your HACC installation and PERMANENTLY DELETE all of your tiles, themes, and settings. Are you sure you want to reset your config?")) {
                e.preventDefault();
                return false;
            }
            return true;
        });
        $('.ui.accordion').accordion();
        $('.ui.checkbox').checkbox();
        $('.ui.dropdown').not('.no-placeholder').dropdown({ fullTextSearch: true });
        $('.ui.no-placeholder.dropdown').dropdown({ placeholder: false });
        // Font dropdown with real font previews.
        $('#Page_PageFontFace option').each(function (_, e) {
            $(e).parent().siblings('.menu').find('.item[data-value="' + $(e).text() + '"]').css('font-family', $(e).text());
        });
        // Only init Packery stuff if we detect we have the preview grid on the page
        if ($('.preview-layout-grid').length) {
            $('#auto-layout').click(() => this.pk.layout());
            // For some reason Draggabilly takes the first element as the grid size, so inject a temporary invisible "fake" one
            $('.preview-layout-grid').prepend(`<div class="preview-layout-item" style="opacity: 0; position: absolute; top: ${window.ccOptions.tilePreviewPadding}px; left: ${window.ccOptions.tilePreviewPadding}px; width: ${window.ccOptions.tilePreviewSize}px; height: ${window.ccOptions.tilePreviewSize}px;" id="grid__tmp"></div>`);
            if (window.ccOptions) {
                this.pk = new Packery('.preview-layout-grid', {
                    itemSelector: '.preview-layout-item',
                    columnWidth: window.ccOptions.tilePreviewSize,
                    rowHeight: window.ccOptions.tilePreviewSize,
                    gutter: window.ccOptions.tilePreviewPadding,
                    initLayout: false
                });
            }
            else {
                this.pk = new Packery('.preview-layout-grid', {
                    itemSelector: '.preview-layout-item',
                    columnWidth: '.preview-layout-item',
                    rowHeight: '.preview-layout-item',
                    gutter: window.ccOptions.tilePreviewPadding,
                    initLayout: false
                });
            }
            this.pk.on('layoutComplete', () => this.writeItemLayout());
            this.pk.on('dragItemPositioned', () => {
                // Things get kinda glitchy if we don't add a slight pause
                setTimeout(() => {
                    this.writeItemLayout();
                    this.pageIsDirty = true;
                }, 25);
            });
            this.writeItemLayout();
            if (typeof Draggabilly === 'function') {
                $('.preview-layout-item').each((_, e) => this.pk.bindDraggabillyEvents(new Draggabilly(e, { containment: '.preview-layout-grid' })));
            }
            else {
                console.warn("Draggabilly is not available - drag and drop interface will not work.");
            }
            $('#grid__tmp').remove();
            this.pk.initShiftLayout(Array.from(document.querySelectorAll('.preview-layout-grid > .preview-layout-item')));
        }
    }
    initUser() {
        if (window.ccOptions.baseUrl) {
            this.conn = new HAConnection(window.ccOptions.baseUrl);
        }
        this.conn.OnStateChanged.on(state => {
            var tiles = this.findTilesByEntityId(state.data.entity_id);
            for (let t of tiles) {
                console.info(`Updating tile for entity "${t.getEntityId()}" to state "${state.data.new_state.state}".`);
            }
        });
        this.conn.initialize();
        this.tileConn = new signalR.HubConnectionBuilder().withUrl('/hubs/tile').build();
        this.tileConn.start().then(() => {
            $('.tiles .tile').each((_, e) => {
                try {
                    let tile = new TileMap.ClassMap[$(e).data('tile-type').toString()](window.ccOptions.pageId, $(e).data('tile-name'), this.tileConn);
                    this.tiles.push(tile);
                }
                catch (ex) {
                    console.error('Error instantiating class "' + ($(e).data('tile-type') || '__MISSING__') + 'Tile". Was it added to the tile type map?', ex, e);
                }
            });
            // Load all initial states
            this.conn.refreshAllStates();
            if (window.ccOptions.autoReturn > 0) {
                window.setTimeout(() => window.location.href = '/d/', window.ccOptions.autoReturn * 1000);
            }
        });
    }
    findTilesByEntityId(entityId) {
        return this.tiles.filter(t => {
            let thisId = t.getEntityId();
            return thisId && thisId.toLowerCase() === entityId.toLowerCase();
        });
    }
    initializeMdiPreview() {
        $('.mdi-icon-placeholder + input').each((_, e) => {
            $(e).keyup((el) => {
                this.refreshDynamicIcon(el.currentTarget);
            });
            this.refreshDynamicIcon(e);
        });
    }
    refreshDynamicIcon(target) {
        $(target).parent().children('.mdi-icon-placeholder').attr('class', 'large icon mdi-icon-placeholder').addClass(`mdi mdi-${$(target).val()}`);
    }
    initializeColorPreview() {
        $('.color-preview + input').each((_, e) => {
            $(e).keyup((el) => {
                this.refreshDynamicColor(el.currentTarget);
            });
            this.refreshDynamicColor(e);
        });
    }
    refreshDynamicColor(target) {
        $(target).parent().children('.color-preview').css('color', `${$(target).val()}`);
    }
    writeItemLayout() {
        var positions = [];
        var tiles = this.pk.getItemElements();
        for (let i = 0; i < tiles.length; i++) {
            let $tile = $(tiles[i]);
            positions.push({
                index: i,
                x: parseInt($tile.css('left').replace('px', '')),
                y: parseInt($tile.css('top').replace('px', '')),
                name: $tile.data('tile-name')
            });
        }
        $('#layout-serialized').val(JSON.stringify(positions));
    }
}
var __app = new CommandCenter();
/**
 * Initializes a pre-existing layout from the element's current position.
 */
Packery.prototype.initShiftLayout = function (elements) {
    this._resetLayout();
    // set item order and horizontal position from saved positions
    this.items = elements.map(function (e) {
        var item = this.getItem(e);
        let x = parseInt(e.style.left.replace('px', ''));
        let y = parseInt(e.style.top.replace('px', ''));
        let w = e.clientWidth;
        let h = e.clientHeight;
        item.rect.x = x - this.gutter;
        item.rect.y = y;
        item.rect.height = h;
        item.rect.width = w;
        item.position.x = x - this.gutter;
        item.position.y = y;
        return item;
    }, this);
    this.shiftLayout();
};
var WeatherTileEntities;
(function (WeatherTileEntities) {
    WeatherTileEntities["entityId"] = "entityId";
    WeatherTileEntities["iconEntity"] = "iconEntity";
    WeatherTileEntities["summaryEntity"] = "summaryEntity";
    WeatherTileEntities["precipChanceEntity"] = "precipChanceEntity";
    WeatherTileEntities["highTempEntity"] = "highTempEntity";
    WeatherTileEntities["lowTempEntity"] = "lowTempEntity";
    WeatherTileEntities["windSpeedEntity"] = "windSpeedEntity";
    WeatherTileEntities["windDirectionEntity"] = "windDirectionEntity";
})(WeatherTileEntities || (WeatherTileEntities = {}));
