﻿using System.ComponentModel.DataAnnotations;

namespace HADotNet.CommandCenter.Models.Config.Tiles
{
    [TileType("light")]
    [TileIcon(TileIconType.Material, "lightbulb")]
    public class LightTile : BaseEntityTile
    {
        /// <summary>
        /// Gets or sets the refresh rate for this tile. A value of 0 indicates no refresh, unless the webpage itself refreshes.
        /// </summary>
        [Display(Name = "Refresh Rate")]
        [Range(0, 86400, ErrorMessage = "Enter a value between 0 and 86400.")]
        public int RefreshRate { get; set; }

        /// <summary>
        /// Gets or sets the override label for this tile.
        /// </summary>
        [Display(Name = "Override Label")]
        public string OverrideLabel { get; set; }

        /// <summary>
        /// Gets or sets the display icon for this light.
        /// </summary>
        [Display(Name = "Display Icon")]
        public string DisplayIcon { get; set; }

        /// <summary>
        /// Gets or sets the display icon for this light when the state is off.
        /// </summary>
        [Display(Name = "Display Off Icon")]
        public string DisplayOffIcon { get; set; }

        /// <summary>
        /// Gets or sets the CSS color when the light is on.
        /// </summary>
        [Display(Name = "On Color")]
        public string OnColor { get; set; }

        /// <summary>
        /// Gets or sets the CSS color when the light is off.
        /// </summary>
        [Display(Name = "Off Color")]
        public string OffColor { get; set; }
    }
}
