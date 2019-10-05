﻿using HADotNet.CommandCenter.Models.Config.Tiles;
using HADotNet.CommandCenter.Services.Interfaces;
using HADotNet.Core.Clients;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Rendering;
using System.Linq;
using System.Threading.Tasks;

namespace HADotNet.CommandCenter.Controllers
{
    [Route("admin/pages/{page}/tile")]
    public class WeatherTileController : BaseTileController
    {
        public IConfigStore ConfigStore { get; }
        public EntityClient EntityClient { get; }

        public WeatherTileController(IConfigStore configStore, EntityClient entityClient)
        {
            ConfigStore = configStore;
            EntityClient = entityClient;
        }

        [Route("add/weather")]
        public async Task<IActionResult> Add()
        {
            ViewBag.Entities = (await EntityClient.GetEntities("sensor")).OrderBy(e => e).Select(e => new SelectListItem(e, e));
            return View();
        }

        [Route("edit/weather")]
        public async Task<IActionResult> Edit([FromRoute] string page, [FromQuery] string name)
        {
            var config = await ConfigStore.GetConfigAsync();

            var tile = config[page].Tiles.FirstOrDefault(t => t.Name == name);

            ViewBag.Entities = (await EntityClient.GetEntities("sensor")).OrderBy(e => e).Select(e => new SelectListItem(e, e));

            return View("Add", tile);
        }

        [HttpPost("add/weather")]
        public async Task<IActionResult> Save([FromRoute] string page, WeatherTile tile)
        {
            if (ModelState.IsValid)
            {
                return await SaveBaseTile(page, ConfigStore, tile);
            }

            ViewBag.Entities = (await EntityClient.GetEntities("sensor")).OrderBy(e => e).Select(e => new SelectListItem(e, e));
            return View("Add", tile);
        }
    }
}
