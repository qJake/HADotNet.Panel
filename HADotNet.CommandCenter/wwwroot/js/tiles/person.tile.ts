﻿/// <reference path="tile.ts" />

class PersonTile extends Tile
{
    private tile: ITile;

    public updateTile(t: ITile)
    {
        this.tile = t;
        super.updateTile(t);
    }

    public updateState(state: IHAStateChangedData): void
    {
        //console.log("State received for: " + tile.name, state);
        let picture: string = state.new_state.attributes['entity_picture'] ? state.new_state.attributes['entity_picture'].toString() : '';
        let location = state.new_state.state.replace('_', ' ');
        let label = state.new_state.attributes['friendly_name'].toString();
        if (this.tile.overrideLabel)
        {
            label = this.tile.overrideLabel;
        }

        let isHome = location.toLowerCase() === 'home';

        // Adjust base URL
        if (!picture.toLowerCase().startsWith('http'))
        {
            picture = window.ccOptions.baseUrl + picture;
        }

        $(`#tile-${this.tile.name}`).find('span[value-name]').text(label);
        $(`#tile-${this.tile.name}`).find('span[value-location]').text(location);
        $(`#tile-${this.tile.name}`).find('span[value-picture]').css('background-image', `url(${picture})`).removeClass('bw');

        if (!isHome)
        {
            $(`#tile-${this.tile.name}`).find('span[value-picture]').addClass('bw');
        }
    }
}