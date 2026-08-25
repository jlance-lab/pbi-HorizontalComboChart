"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const MARKER_SHAPE_ITEMS: powerbi.IEnumMember[] = [
    { value: "circle", displayName: "Circle" },
    { value: "square", displayName: "Square" },
    { value: "triangle", displayName: "Triangle" },
    { value: "diamond", displayName: "Diamond" },
    { value: "cross", displayName: "Cross" },
    { value: "star", displayName: "Star" }
];

export const LEGEND_POSITION_ITEMS: powerbi.IEnumMember[] = [
    { value: "Top", displayName: "Top" },
    { value: "Bottom", displayName: "Bottom" },
    { value: "Right", displayName: "Right" }
];

/**
 * Bar series colors.
 * Slices for this card are built dynamically in visual.ts (one ColorPicker per bar measure column),
 * since the set of series is only known once data is bound.
 */
export class DataPointCardSettings extends FormattingSettingsCard {
    name: string = "dataPoint";
    displayName: string = "Bar colors";
    slices: Array<FormattingSettingsSlice> = [];
}

/**
 * Bar layout: stacked vs clustered, and spacing between category bands.
 */
class LayoutCardSettings extends FormattingSettingsCard {
    stacked = new formattingSettings.ToggleSwitch({
        name: "stacked",
        displayName: "Stacked",
        value: true
    });

    barPadding = new formattingSettings.Slider({
        name: "barPadding",
        displayName: "Bar padding",
        value: 0.2,
        options: {
            minValue: { value: 0, type: powerbi.visuals.ValidatorType.Min },
            maxValue: { value: 0.8, type: powerbi.visuals.ValidatorType.Max }
        }
    });

    name: string = "layout";
    displayName: string = "Bar layout";
    slices: Array<FormattingSettingsSlice> = [this.stacked, this.barPadding];
}

/**
 * Marker measure formatting: shape, size and color.
 */
class MarkerCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show markers",
        value: true
    });

    shape = new formattingSettings.ItemDropdown({
        name: "shape",
        displayName: "Shape",
        items: MARKER_SHAPE_ITEMS,
        value: MARKER_SHAPE_ITEMS[0]
    });

    size = new formattingSettings.NumUpDown({
        name: "size",
        displayName: "Size",
        value: 6,
        options: {
            minValue: { value: 2, type: powerbi.visuals.ValidatorType.Min },
            maxValue: { value: 30, type: powerbi.visuals.ValidatorType.Max }
        }
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Color",
        value: { value: "#252423" }
    });

    name: string = "marker";
    displayName: string = "Markers";
    slices: Array<FormattingSettingsSlice> = [this.show, this.shape, this.size, this.color];
}

/**
 * Category axis (the vertical axis, listing categories top-to-bottom).
 */
class CategoryAxisCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 10
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        value: { value: "#252423" }
    });

    showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "Show axis title",
        value: true
    });

    titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "Axis title",
        value: "",
        placeholder: "Category"
    });

    name: string = "categoryAxis";
    displayName: string = "Category axis (Y)";
    slices: Array<FormattingSettingsSlice> = [this.show, this.fontSize, this.fontColor, this.showTitle, this.titleText];
}

/**
 * Value axis (the horizontal axis, shared by bars and markers).
 */
class ValueAxisCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 10
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        value: { value: "#252423" }
    });

    showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "Show axis title",
        value: true
    });

    titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "Axis title",
        value: "",
        placeholder: "Value"
    });

    start = new formattingSettings.NumUpDown({
        name: "start",
        displayName: "Start",
        value: null
    });

    end = new formattingSettings.NumUpDown({
        name: "end",
        displayName: "End",
        value: null
    });

    name: string = "valueAxis";
    displayName: string = "Value axis (X)";
    slices: Array<FormattingSettingsSlice> = [this.show, this.fontSize, this.fontColor, this.showTitle, this.titleText, this.start, this.end];
}

/**
 * Legend identifying bar series (and the marker measure).
 */
class LegendCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    position = new formattingSettings.ItemDropdown({
        name: "position",
        displayName: "Position",
        items: LEGEND_POSITION_ITEMS,
        value: LEGEND_POSITION_ITEMS[0]
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 9
    });

    name: string = "legend";
    displayName: string = "Legend";
    slices: Array<FormattingSettingsSlice> = [this.show, this.position, this.fontSize];
}

/**
 * Visual formatting settings model.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    dataPointCard = new DataPointCardSettings();
    layoutCard = new LayoutCardSettings();
    markerCard = new MarkerCardSettings();
    categoryAxisCard = new CategoryAxisCardSettings();
    valueAxisCard = new ValueAxisCardSettings();
    legendCard = new LegendCardSettings();

    cards = [this.dataPointCard, this.layoutCard, this.markerCard, this.categoryAxisCard, this.valueAxisCard, this.legendCard];
}
