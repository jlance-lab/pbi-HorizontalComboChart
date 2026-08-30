"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { formattingSettings, FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

import { VisualFormattingSettingsModel } from "./settings";

type GSelection = d3.Selection<SVGGElement, unknown, null, undefined>;

interface BarSeriesInfo {
    queryName: string;
    displayName: string;
    color: string;
    values: number[];
    format: string;
    formatter: valueFormatter.IValueFormatter;
}

interface MarkerSeriesInfo {
    displayName: string;
    values: (number | null)[];
    format: string;
    formatter: valueFormatter.IValueFormatter;
}

interface ParsedData {
    categories: string[];
    categoryDisplayName: string;
    categorySelectionIds: ISelectionId[];
    barSeries: BarSeriesInfo[];
    markerSeries: MarkerSeriesInfo | null;
}

interface LegendItem {
    label: string;
    color: string;
}

const MARKER_SYMBOLS: { [shape: string]: d3.SymbolType } = {
    circle: d3.symbolCircle,
    square: d3.symbolSquare,
    triangle: d3.symbolTriangle,
    diamond: d3.symbolDiamond,
    cross: d3.symbolCross,
    star: d3.symbolStar
};

function sanitizeClassName(name: string): string {
    return "s_" + (name || "series").replace(/[^a-zA-Z0-9_-]/g, "_");
}

const DIMMED_OPACITY = 0.35;

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private target: HTMLElement;
    private colorPalette: ISandboxExtendedColorPalette;
    private selectionManager: ISelectionManager;
    private interactiveBindings: { selection: d3.Selection<d3.BaseType, any, any, any>; getId: (d: any) => ISelectionId }[] = [];

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landingPage: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private legendGroup: GSelection;
    private xAxisGroup: GSelection;
    private yAxisGroup: GSelection;
    private barsGroup: GSelection;
    private markersGroup: GSelection;
    private titlesGroup: GSelection;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private tooltipServiceWrapper: ITooltipServiceWrapper;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.colorPalette = options.host.colorPalette as ISandboxExtendedColorPalette;
        this.formattingSettingsService = new FormattingSettingsService();
        this.tooltipServiceWrapper = createTooltipServiceWrapper(options.host.tooltipService, options.element);
        this.selectionManager = options.host.createSelectionManager();
        this.target = options.element;

        this.landingPage = d3.select(this.target)
            .append("div")
            .attr("class", "landingPage")
            .style("display", "none");
        this.landingPage.append("div").attr("class", "landingPage-title").text("Horizontal combo chart");
        const landingPageSteps = this.landingPage.append("ul").attr("class", "landingPage-steps");
        [
            "Add a field to Category",
            "Add one or more fields to Y-axis (bars)",
            "Optionally add a field to Markers for a target/threshold indicator"
        ].forEach(step => landingPageSteps.append("li").text(step));

        this.svg = d3.select(this.target)
            .append("svg")
            .attr("class", "horizontalComboChart");

        this.legendGroup = this.svg.append("g").attr("class", "legend");
        this.xAxisGroup = this.svg.append("g").attr("class", "x-axis");
        this.yAxisGroup = this.svg.append("g").attr("class", "y-axis");
        this.barsGroup = this.svg.append("g").attr("class", "bars");
        this.markersGroup = this.svg.append("g").attr("class", "markers");
        this.titlesGroup = this.svg.append("g").attr("class", "titles");

        // Keep rendered opacity in sync when selection changes for a reason other than
        // clicking a data point in this visual instance (e.g. a bookmark or "Clear selection").
        this.selectionManager.registerOnSelectCallback(ids => {
            this.applySelectionStyles(ids as ISelectionId[]);
        });

        // Clicking empty canvas clears the selection, matching built-in visuals.
        this.svg.on("click", () => {
            if (!this.isInteractive()) { return; }
            this.selectionManager.clear().then(() => this.applySelectionStyles([]));
        });
        this.svg.on("contextmenu", (event: MouseEvent) => {
            if (!this.isInteractive()) { return; }
            event.preventDefault();
            this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);

        try {
            const dataView: DataView = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const hasCategories = !!(dataView && dataView.categorical && dataView.categorical.categories && dataView.categorical.categories.length);
            const valueColumns = (dataView && dataView.categorical && dataView.categorical.values) || [];
            const hasMeasureOrMarker = valueColumns.some(column => column.source.roles && (column.source.roles["measure"] || column.source.roles["marker"]));

            if (!hasCategories || !hasMeasureOrMarker) {
                this.clear();
                this.svg.style("display", "none");
                this.landingPage.style("display", "flex");
                this.events.renderingFinished(options);
                return;
            }
            this.landingPage.style("display", "none");
            this.svg.style("display", "block");

            const parsed = this.parseData(dataView);
            this.buildDynamicColorSlices(parsed.barSeries);
            this.render(parsed, width, height);

            this.events.renderingFinished(options);
        } catch (error) {
            console.error("Error in update method", error);
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private clear(): void {
        this.barsGroup.selectAll("*").remove();
        this.markersGroup.selectAll("*").remove();
        this.xAxisGroup.selectAll("*").remove();
        this.yAxisGroup.selectAll("*").remove();
        this.titlesGroup.selectAll("*").remove();
        this.legendGroup.selectAll("*").remove();
    }

    private parseData(dataView: DataView): ParsedData {
        const categorical = dataView.categorical;
        const categoryColumn = categorical.categories[0];
        const categories = categoryColumn.values.map(v => (v === null || v === undefined) ? "(Blank)" : String(v));

        const barSeries: BarSeriesInfo[] = [];
        let markerSeries: MarkerSeriesInfo | null = null;

        (categorical.values || []).forEach((column: DataViewValueColumn, index: number) => {
            const roles = column.source.roles || {};
            const values = column.values.map(v => (v === null || v === undefined || isNaN(Number(v))) ? null : Number(v));
            const format = valueFormatter.getFormatStringByColumn(column.source) || undefined;
            const formatter = valueFormatter.create({ format });

            if (roles["marker"]) {
                markerSeries = {
                    displayName: column.source.displayName,
                    values,
                    format,
                    formatter
                };
            } else if (roles["measure"]) {
                barSeries.push({
                    queryName: column.source.queryName,
                    displayName: column.source.displayName,
                    color: this.getSeriesColor(column, index),
                    values: values.map(v => v === null ? 0 : v),
                    format,
                    formatter
                });
            }
        });

        const categorySelectionIds = categories.map((_, i) =>
            this.host.createSelectionIdBuilder().withCategory(categoryColumn, i).createSelectionId()
        );

        return { categories, categoryDisplayName: categoryColumn.source.displayName, categorySelectionIds, barSeries, markerSeries };
    }

    private isInteractive(): boolean {
        return this.host.hostCapabilities.allowInteractions !== false;
    }

    private currentOpacity(id: ISelectionId, selectedIds: ISelectionId[]): number {
        if (!selectedIds.length) { return 1; }
        return selectedIds.some(selected => selected.equals(id)) ? 1 : DIMMED_OPACITY;
    }

    /** Re-applies opacity to every rendered data point without a full re-render, so selection feedback is instant. */
    private applySelectionStyles(selectedIds: ISelectionId[] = this.selectionManager.getSelectionIds() as ISelectionId[]): void {
        this.interactiveBindings.forEach(({ selection, getId }) => {
            selection.style("opacity", (d: unknown) => this.currentOpacity(getId(d), selectedIds));
        });
    }

    /** Attaches click-to-select and right-click context menu behavior to a rendered selection, keyed by a per-datum selection ID. */
    private wireInteractivity<T>(selection: d3.Selection<d3.BaseType, T, any, any>, getId: (d: T) => ISelectionId): void {
        this.interactiveBindings.push({ selection, getId });

        if (!this.isInteractive()) { return; }

        selection
            .style("cursor", "pointer")
            .on("click", (event: MouseEvent, d: T) => {
                event.stopPropagation();
                this.selectionManager.select(getId(d), event.ctrlKey || event.metaKey)
                    .then(ids => this.applySelectionStyles(ids as ISelectionId[]));
            })
            .on("contextmenu", (event: MouseEvent, d: T) => {
                event.preventDefault();
                event.stopPropagation();
                this.selectionManager.showContextMenu(getId(d), { x: event.clientX, y: event.clientY });
            });
    }

    private getSeriesColor(column: DataViewValueColumn, index: number): string {
        const objects = column.source.objects as { dataPoint?: { fill?: { solid?: { color?: string } } } };
        if (objects && objects.dataPoint && objects.dataPoint.fill && objects.dataPoint.fill.solid && objects.dataPoint.fill.solid.color) {
            return objects.dataPoint.fill.solid.color;
        }
        return this.colorPalette.getColor(column.source.queryName || column.source.displayName || String(index)).value;
    }

    /**
     * The set of bar measures isn't known until data is bound, so the per-series
     * color pickers for the "dataPoint" object are built at update time rather
     * than declared statically in settings.ts.
     */
    private buildDynamicColorSlices(barSeries: BarSeriesInfo[]): void {
        this.formattingSettings.dataPointCard.slices = barSeries.map(series =>
            new formattingSettings.ColorPicker({
                name: "fill",
                displayName: series.displayName,
                selector: { metadata: series.queryName } as powerbi.data.Selector,
                value: { value: series.color }
            })
        );
    }

    private render(parsed: ParsedData, width: number, height: number): void {
        this.clear();
        this.interactiveBindings = [];

        const { categories, categorySelectionIds, barSeries, markerSeries } = parsed;
        if (!categories.length || (!barSeries.length && !markerSeries)) {
            return;
        }

        const settings = this.formattingSettings;
        const layout = settings.layoutCard;
        const marker = settings.markerCard;
        const catAxis = settings.categoryAxisCard;
        const valAxis = settings.valueAxisCard;
        const legend = settings.legendCard;

        const stacked = layout.stacked.value;
        const barPadding = layout.barPadding.value;
        const showMarker = marker.show.value && !!markerSeries;

        const legendItems: LegendItem[] = barSeries.map(s => ({ label: s.displayName, color: s.color }));
        if (showMarker) {
            legendItems.push({ label: markerSeries.displayName, color: marker.color.value.value });
        }
        const legendPosition = legend.position.value.value as string;
        const legendFontSize = legend.fontSize.value;
        const showLegend = legend.show.value && legendItems.length > 0;

        // ---- default axis titles: the bound column name(s), same as Power BI's built-in visuals ----
        const defaultCategoryAxisTitle = parsed.categoryDisplayName;
        const defaultValueAxisTitle = [
            ...barSeries.map(s => s.displayName),
            ...(showMarker && markerSeries ? [markerSeries.displayName] : [])
        ].join(", ");
        catAxis.titleText.placeholder = defaultCategoryAxisTitle || "Category";
        valAxis.titleText.placeholder = defaultValueAxisTitle || "Value";
        const categoryAxisTitle = catAxis.titleText.value || defaultCategoryAxisTitle;
        const valueAxisTitle = valAxis.titleText.value || defaultValueAxisTitle;

        // ---- reserve space for legend ----
        let legendBandHeight = 0;
        let legendRightWidth = 0;
        if (showLegend) {
            if (legendPosition === "Right") {
                const longest = Math.max(...legendItems.map(i => i.label.length));
                legendRightWidth = longest * legendFontSize * 0.62 + 28;
            } else {
                legendBandHeight = legendFontSize + 14;
            }
        }

        // ---- margins ----
        const marginRight = 14 + legendRightWidth;
        const marginTop = 8 + (showLegend && legendPosition === "Top" ? legendBandHeight : 0);

        const valueAxisTitleSpace = (valAxis.show.value && valAxis.showTitle.value && valueAxisTitle) ? 20 : 0;
        const marginBottom = 8
            + (showLegend && legendPosition === "Bottom" ? legendBandHeight : 0)
            + (valAxis.show.value ? valAxis.fontSize.value + 14 : 4)
            + valueAxisTitleSpace;

        const categoryAxisTitleSpace = (catAxis.show.value && catAxis.showTitle.value && categoryAxisTitle) ? 18 : 0;
        const maxCategoryLabelLength = Math.max(0, ...categories.map(c => c.length));
        const marginLeft = categoryAxisTitleSpace
            + (catAxis.show.value ? Math.min(160, Math.max(40, maxCategoryLabelLength * catAxis.fontSize.value * 0.62)) : 8)
            + 6;

        const plotLeft = marginLeft;
        const plotRight = Math.max(plotLeft + 10, width - marginRight);
        const plotTop = marginTop;
        const plotBottom = Math.max(plotTop + 10, height - marginBottom);

        // ---- scales ----
        const paddingRatio = Math.min(0.9, Math.max(0.05, barPadding));
        const yScale = d3.scaleBand<string>()
            .domain(categories)
            .range([plotTop, plotBottom])
            .paddingInner(paddingRatio)
            .paddingOuter(paddingRatio / 2);

        let valueMin = 0;
        let valueMax = 0;

        if (stacked) {
            categories.forEach((_, catIndex) => {
                let pos = 0;
                let neg = 0;
                barSeries.forEach(s => {
                    const v = s.values[catIndex] || 0;
                    if (v >= 0) { pos += v; } else { neg += v; }
                });
                valueMax = Math.max(valueMax, pos);
                valueMin = Math.min(valueMin, neg);
            });
        } else {
            barSeries.forEach(s => {
                s.values.forEach(v => {
                    valueMax = Math.max(valueMax, v);
                    valueMin = Math.min(valueMin, v);
                });
            });
        }

        if (showMarker && markerSeries) {
            markerSeries.values.forEach(v => {
                if (v === null) { return; }
                valueMax = Math.max(valueMax, v);
                valueMin = Math.min(valueMin, v);
            });
        }

        if (valueMax === valueMin) { valueMax = valueMin + 1; }

        const domainStart = (valAxis.start.value !== null && valAxis.start.value !== undefined) ? valAxis.start.value : valueMin;
        const domainEnd = (valAxis.end.value !== null && valAxis.end.value !== undefined) ? valAxis.end.value : valueMax;

        const xScale = d3.scaleLinear()
            .domain([domainStart, domainEnd])
            .nice()
            .range([plotLeft, plotRight]);

        // Axis ticks use the first bound measure's format string (falling back to the marker's),
        // with auto display-unit scaling (e.g. "20K") based on the domain's magnitude.
        const axisFormatSource = (barSeries[0] && barSeries[0].format) || (markerSeries && markerSeries.format) || undefined;
        const axisValueFormatter = valueFormatter.create({
            format: axisFormatSource,
            value: Math.max(Math.abs(domainStart), Math.abs(domainEnd)) || undefined
        });

        // ---- axes ----
        if (catAxis.show.value) {
            const yAxis = d3.axisLeft(yScale).tickSizeOuter(0);
            this.yAxisGroup.attr("transform", `translate(${plotLeft},0)`).call(yAxis);
            this.yAxisGroup.selectAll("text")
                .style("font-size", `${catAxis.fontSize.value}px`)
                .style("fill", catAxis.fontColor.value.value);
            this.yAxisGroup.selectAll("path,line").style("stroke", "#ccc");
        }

        if (valAxis.show.value) {
            // Thin out ticks so formatted labels (which can be much wider than a bare number,
            // e.g. "$1,234.56") don't overlap when the visual is narrow, matching native visuals.
            // d3's own `.ticks(n)` only aims for roughly n "nice" values and can overshoot, so the
            // candidate list is explicitly capped via tickValues() to guarantee the fit.
            const sampleLabelWidth = Math.max(
                axisValueFormatter.format(domainStart).length,
                axisValueFormatter.format(domainEnd).length,
                axisValueFormatter.format((domainStart + domainEnd) / 2).length
            ) * valAxis.fontSize.value * 0.62;
            const maxTicks = Math.max(1, Math.floor((plotRight - plotLeft) / (sampleLabelWidth + 16)));

            let tickValues = xScale.ticks(maxTicks);
            if (tickValues.length > maxTicks) {
                const step = Math.ceil(tickValues.length / maxTicks);
                tickValues = tickValues.filter((_, i) => i % step === 0);
            }

            const xAxis = d3.axisBottom(xScale).tickSizeOuter(0).tickValues(tickValues).tickFormat(d => axisValueFormatter.format(d));
            this.xAxisGroup.attr("transform", `translate(0,${plotBottom})`).call(xAxis);
            this.xAxisGroup.selectAll("text")
                .style("font-size", `${valAxis.fontSize.value}px`)
                .style("fill", valAxis.fontColor.value.value);
            this.xAxisGroup.selectAll("path,line").style("stroke", "#ccc");
        }

        // ---- bars ----
        const zeroX = xScale(0);

        if (stacked) {
            const stackKeys = barSeries.map(s => s.queryName);
            const stackData = categories.map((cat, i) => {
                const row: { [key: string]: number | string | ISelectionId } = { category: cat, selectionId: categorySelectionIds[i] };
                barSeries.forEach(s => { row[s.queryName] = s.values[i] || 0; });
                return row;
            });
            const stackGen = d3.stack<{ [key: string]: number | string | ISelectionId }>().keys(stackKeys).offset(d3.stackOffsetDiverging);
            const series = stackGen(stackData);

            series.forEach((seriesData, sIndex) => {
                const info = barSeries[sIndex];
                const barSelection = this.barsGroup.append("g")
                    .attr("class", sanitizeClassName(info.queryName))
                    .selectAll("rect")
                    .data(seriesData)
                    .join("rect")
                    .attr("y", d => yScale(String(d.data.category)) ?? 0)
                    .attr("height", yScale.bandwidth())
                    .attr("x", d => xScale(Math.min(d[0], d[1])))
                    .attr("width", d => Math.abs(xScale(d[1]) - xScale(d[0])))
                    .attr("fill", info.color);

                this.tooltipServiceWrapper.addTooltip(barSelection, (d: d3.SeriesPoint<{ [key: string]: number | string | ISelectionId }>): VisualTooltipDataItem[] => [
                    { displayName: defaultCategoryAxisTitle, value: String(d.data.category) },
                    { displayName: info.displayName, value: info.formatter.format(d[1] - d[0]), color: info.color }
                ]);
                this.wireInteractivity(barSelection, d => d.data.selectionId as ISelectionId);
            });
        } else {
            const innerScale = d3.scaleBand<string>()
                .domain(barSeries.map(s => s.queryName))
                .range([0, yScale.bandwidth()])
                .padding(0.1);

            barSeries.forEach(info => {
                const barData = categories.map((cat, i) => ({ cat, value: info.values[i] || 0, selectionId: categorySelectionIds[i] }));
                const barSelection = this.barsGroup.append("g")
                    .attr("class", sanitizeClassName(info.queryName))
                    .selectAll("rect")
                    .data(barData)
                    .join("rect")
                    .attr("y", d => (yScale(d.cat) ?? 0) + (innerScale(info.queryName) ?? 0))
                    .attr("height", Math.max(1, innerScale.bandwidth()))
                    .attr("x", d => xScale(Math.min(0, d.value)))
                    .attr("width", d => Math.abs(xScale(d.value) - zeroX))
                    .attr("fill", info.color);

                this.tooltipServiceWrapper.addTooltip(barSelection, (d: { cat: string; value: number }): VisualTooltipDataItem[] => [
                    { displayName: defaultCategoryAxisTitle, value: d.cat },
                    { displayName: info.displayName, value: info.formatter.format(d.value), color: info.color }
                ]);
                this.wireInteractivity(barSelection, d => d.selectionId);
            });
        }

        // ---- markers ----
        if (showMarker && markerSeries) {
            const shape = marker.shape.value.value as string;
            const size = marker.size.value;
            const color = marker.color.value.value;

            const markerData = categories
                .map((cat, i) => ({ cat, value: markerSeries.values[i], selectionId: categorySelectionIds[i] }))
                .filter((d): d is { cat: string; value: number; selectionId: ISelectionId } => d.value !== null);

            const markerGroups = this.markersGroup.selectAll<SVGGElement, { cat: string; value: number; selectionId: ISelectionId }>("g")
                .data(markerData)
                .join("g")
                .attr("transform", d => `translate(${xScale(d.value)}, ${(yScale(d.cat) ?? 0) + yScale.bandwidth() / 2})`);

            if (shape === "line") {
                // A short crosshair spanning (and slightly overshooting) the bar's band, like a target/threshold line.
                const halfLength = yScale.bandwidth() / 2 + 4;
                const strokeWidth = Math.max(1.5, size / 3);
                markerGroups.append("line")
                    .attr("y1", -halfLength)
                    .attr("y2", halfLength)
                    .attr("stroke", color)
                    .attr("stroke-width", strokeWidth)
                    .attr("stroke-linecap", "round");
            } else {
                const symbolType = MARKER_SYMBOLS[shape] || d3.symbolCircle;
                const symbolGenerator = d3.symbol().type(symbolType).size(size * size * 1.6);
                markerGroups.append("path")
                    .attr("d", symbolGenerator)
                    .attr("fill", color)
                    .attr("stroke", "#fff")
                    .attr("stroke-width", 1);
            }

            this.tooltipServiceWrapper.addTooltip(markerGroups, (d: { cat: string; value: number }): VisualTooltipDataItem[] => [
                { displayName: defaultCategoryAxisTitle, value: d.cat },
                { displayName: markerSeries.displayName, value: markerSeries.formatter.format(d.value), color }
            ]);
            this.wireInteractivity(markerGroups, d => d.selectionId);
        }

        this.applySelectionStyles();

        // ---- axis titles ----
        if (valAxis.show.value && valAxis.showTitle.value && valueAxisTitle) {
            this.titlesGroup.append("text")
                .attr("x", (plotLeft + plotRight) / 2)
                .attr("y", height - 4)
                .attr("text-anchor", "middle")
                .style("font-size", `${valAxis.fontSize.value}px`)
                .style("fill", valAxis.fontColor.value.value)
                .text(valueAxisTitle);
        }

        if (catAxis.show.value && catAxis.showTitle.value && categoryAxisTitle) {
            this.titlesGroup.append("text")
                .attr("transform", `translate(10, ${(plotTop + plotBottom) / 2}) rotate(-90)`)
                .attr("text-anchor", "middle")
                .style("font-size", `${catAxis.fontSize.value}px`)
                .style("fill", catAxis.fontColor.value.value)
                .text(categoryAxisTitle);
        }

        // ---- legend ----
        if (showLegend) {
            this.renderLegend(legendItems, legendPosition, legendFontSize, width, height, plotLeft, plotRight, plotTop, legendBandHeight);
        }
    }

    private renderLegend(
        items: LegendItem[],
        position: string,
        fontSize: number,
        width: number,
        height: number,
        plotLeft: number,
        plotRight: number,
        plotTop: number,
        legendBandHeight: number
    ): void {
        const swatchSize = fontSize;

        if (position === "Right") {
            let y = plotTop;
            const x = plotRight + 16;
            items.forEach(item => {
                const g = this.legendGroup.append("g").attr("transform", `translate(${x}, ${y})`);
                g.append("rect").attr("width", swatchSize).attr("height", swatchSize).attr("fill", item.color).attr("rx", 2);
                g.append("text").attr("x", swatchSize + 5).attr("y", swatchSize - 1).style("font-size", `${fontSize}px`).text(item.label);
                y += fontSize + 10;
            });
            return;
        }

        const centerY = position === "Top" ? Math.max(4, legendBandHeight / 2) : height - legendBandHeight / 2;
        let x = plotLeft;
        items.forEach(item => {
            const g = this.legendGroup.append("g").attr("transform", `translate(${x}, ${centerY - swatchSize / 2})`);
            g.append("rect").attr("width", swatchSize).attr("height", swatchSize).attr("fill", item.color).attr("rx", 2);
            const text = g.append("text").attr("x", swatchSize + 5).attr("y", swatchSize - 1).style("font-size", `${fontSize}px`).text(item.label);
            let textWidth = item.label.length * fontSize * 0.62;
            const node = text.node();
            if (node && typeof node.getComputedTextLength === "function") {
                try { textWidth = node.getComputedTextLength(); } catch { /* not attached yet */ }
            }
            x += swatchSize + 5 + textWidth + 16;
        });
    }
}
