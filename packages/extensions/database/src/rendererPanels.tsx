import { DATA_ATTRS } from "@pen/react";
import React, { useEffect, useState } from "react";
import type {
	ColumnType,
	DatabaseColumnDef,
	DatabaseViewState,
	FacetBucket,
	FilterCondition,
	FilterGroup,
	FilterOperator,
} from "./types";
import {
	addFilterNodeAtPath,
	createDefaultFilterCondition,
	DATE_RELATIVE_FILTER_OPTIONS,
	dateFilterNeedsValue,
	defaultOperatorFor,
	getDateFilterRangeValue,
	getDateFilterSingleValue,
	getDefaultFilterValue,
	getDefaultFilterValueForOperator,
	getFilterPathKey,
	operatorNeedsValue,
	operatorOptionsFor,
	removeFilterNodeAtPath,
	updateFilterConditionAtPath,
	updateFilterGroupOperatorAtPath,
} from "./utils/databaseRenderer";

const COLUMN_TYPES: ColumnType[] = [
	"text",
	"number",
	"checkbox",
	"select",
	"multiSelect",
	"date",
	"url",
	"email",
	"relation",
];

const OPTION_COLOR_CHOICES = [
	"gray",
	"red",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
] as const;

type FilterNode = FilterCondition | FilterGroup;
type FilterPath = number[];

export function ColumnMenu(props: {
	column: DatabaseColumnDef | undefined;
	onClose: () => void;
	onRename: (title: string) => void;
	onChangeType: (type: ColumnType) => void;
	onDelete: () => void;
	onToggleVisibility: () => void;
	onChangePin: (nextPinned: "left" | "right" | undefined) => void;
	onAddOption: (value: string, color?: string) => void;
	onRenameOption: (optionId: string, value: string) => void;
	onRecolorOption: (optionId: string, color: string) => void;
	onRemoveOption: (optionId: string) => void;
	onMoveOption: (optionId: string, direction: "up" | "down") => void;
}) {
	const {
		column,
		onClose,
		onRename,
		onChangeType,
		onDelete,
		onToggleVisibility,
		onChangePin,
		onAddOption,
		onRenameOption,
		onRecolorOption,
		onRemoveOption,
		onMoveOption,
	} = props;

	const [renameValue, setRenameValue] = useState(column?.title ?? "");
	const [showTypeMenu, setShowTypeMenu] = useState(false);
	const [newOptionValue, setNewOptionValue] = useState("");
	const [newOptionColor, setNewOptionColor] = useState<string>("gray");

	const typeItems = COLUMN_TYPES.map((type) => (
		<button
			key={type}
			className={`pen-db-col-menu-item ${column?.type === type ? "pen-db-col-menu-item-active" : ""}`}
			onClick={() => onChangeType(type)}
		>
			{type}
		</button>
	));
	const typeMenu = showTypeMenu ? (
		<div className="pen-db-col-type-submenu">{typeItems}</div>
	) : null;
	const supportsOptionEditing =
		column?.type === "select" || column?.type === "multiSelect";
	const pinMenuButtons = (
		<div className="pen-db-col-menu-section">
			<button className="pen-db-col-menu-item" onClick={() => onChangePin("left")}>
				Pin left
			</button>
			<button className="pen-db-col-menu-item" onClick={() => onChangePin("right")}>
				Pin right
			</button>
			<button
				className="pen-db-col-menu-item"
				onClick={() => onChangePin(undefined)}
			>
				Unpin
			</button>
		</div>
	);
	const optionColorItems = OPTION_COLOR_CHOICES.map((color) => (
		<option key={color} value={color}>
			{color}
		</option>
	));
	const optionEditorRows = (column?.options ?? []).map((option, index, options) => (
		<OptionEditorRow
			key={option.id}
			option={option}
			colorItems={optionColorItems}
			canMoveUp={index > 0}
			canMoveDown={index < options.length - 1}
			onRename={(value) => onRenameOption(option.id, value)}
			onRecolor={(color) => onRecolorOption(option.id, color)}
			onRemove={() => onRemoveOption(option.id)}
			onMoveUp={() => onMoveOption(option.id, "up")}
			onMoveDown={() => onMoveOption(option.id, "down")}
		/>
	));
	const optionEditor = supportsOptionEditing ? (
		<div className="pen-db-col-menu-section">
			<div className="pen-db-col-menu-label">Options</div>
			{optionEditorRows}
			<div className="pen-db-col-option-add">
				<input
					className="pen-db-col-rename-input"
					value={newOptionValue}
					placeholder="New option"
					onChange={(event) => setNewOptionValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							onAddOption(newOptionValue, newOptionColor);
							setNewOptionValue("");
						}
					}}
				/>
				<select
					value={newOptionColor}
					onChange={(event) => setNewOptionColor(event.target.value)}
				>
					{optionColorItems}
				</select>
				<button
					className="pen-db-col-menu-item"
					onClick={() => {
						onAddOption(newOptionValue, newOptionColor);
						setNewOptionValue("");
					}}
				>
					Add
				</button>
			</div>
		</div>
	) : null;

	return (
		<div
			className="pen-db-col-menu"
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDownCapture={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="pen-db-col-menu-section">
				<input
					className="pen-db-col-rename-input"
					value={renameValue}
					onChange={(event) => setRenameValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							onRename(renameValue);
						}
						if (event.key === "Escape") {
							onClose();
						}
					}}
					autoFocus
				/>
			</div>
			<div className="pen-db-col-menu-section">
				<button
					className="pen-db-col-menu-item"
					onClick={() => setShowTypeMenu(!showTypeMenu)}
				>
					Type: {column?.type ?? "text"} ▸
				</button>
				{typeMenu}
				{column?.type === "formula" ? (
					<div className="pen-db-col-menu-hint">
						Formula columns are read-only until the evaluator lands.
					</div>
				) : null}
			</div>
			{optionEditor}
			<div className="pen-db-col-menu-section">
				<button className="pen-db-col-menu-item" onClick={onToggleVisibility}>
					Hide column
				</button>
			</div>
			{pinMenuButtons}
			<div className="pen-db-col-menu-section">
				<button
					className="pen-db-col-menu-item pen-db-col-menu-item-danger"
					onClick={onDelete}
				>
					Delete column
				</button>
			</div>
			<div className="pen-db-col-menu-section">
				<button className="pen-db-col-menu-item" onClick={onClose}>
					Close
				</button>
			</div>
		</div>
	);
}

function OptionEditorRow(props: {
	option: NonNullable<DatabaseColumnDef["options"]>[number];
	colorItems: React.ReactElement[];
	canMoveUp: boolean;
	canMoveDown: boolean;
	onRename: (value: string) => void;
	onRecolor: (color: string) => void;
	onRemove: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}) {
	const {
		option,
		colorItems,
		canMoveUp,
		canMoveDown,
		onRename,
		onRecolor,
		onRemove,
		onMoveUp,
		onMoveDown,
	} = props;

	const [value, setValue] = useState(option.value);

	useEffect(() => {
		setValue(option.value);
	}, [option.id, option.value]);

	return (
		<div className="pen-db-col-option-row">
			<input
				className="pen-db-col-rename-input"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onBlur={() => onRename(value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						onRename(value);
					}
				}}
			/>
			<select
				value={option.color ?? "gray"}
				onChange={(event) => onRecolor(event.target.value)}
			>
				{colorItems}
			</select>
			<button className="pen-db-col-menu-item" onClick={onMoveUp} disabled={!canMoveUp}>
				↑
			</button>
			<button
				className="pen-db-col-menu-item"
				onClick={onMoveDown}
				disabled={!canMoveDown}
			>
				↓
			</button>
			<button
				className="pen-db-col-menu-item pen-db-col-menu-item-danger"
				onClick={onRemove}
			>
				×
			</button>
		</div>
	);
}

export function SortPanel(props: {
	columnSchema: DatabaseColumnDef[];
	sorts: NonNullable<DatabaseViewState["sort"]>;
	onChange: (sorts: NonNullable<DatabaseViewState["sort"]>) => void;
	onClose: () => void;
}) {
	const { columnSchema, sorts, onChange, onClose } = props;

	function handleAddSort() {
		const firstColumn = columnSchema[0];
		if (!firstColumn) {
			return;
		}
		onChange([
			...sorts,
			{
				columnId: firstColumn.id,
				direction: "asc",
			},
		]);
	}

	function handleUpdateSort(
		index: number,
		patch: Partial<NonNullable<DatabaseViewState["sort"]>[number]>,
	) {
		const nextSorts = sorts.map((sort, sortIndex) =>
			sortIndex === index ? { ...sort, ...patch } : sort,
		);
		onChange(nextSorts);
	}

	function handleRemoveSort(index: number) {
		onChange(sorts.filter((_, sortIndex) => sortIndex !== index));
	}

	function handleMoveSort(index: number, direction: "up" | "down") {
		const targetIndex = direction === "up" ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= sorts.length) {
			return;
		}
		const nextSorts = [...sorts];
		const [movedSort] = nextSorts.splice(index, 1);
		nextSorts.splice(targetIndex, 0, movedSort);
		onChange(nextSorts);
	}

	const columnOptionItems = columnSchema.map((column) => (
		<option key={column.id} value={column.id}>
			{column.title}
		</option>
	));
	const sortRows = sorts.map((sort, index) => (
		<div key={`${sort.columnId}:${index}`} className="pen-db-sort-row" data-sort-row={index}>
			<select
				data-sort-column={index}
				value={sort.columnId}
				onChange={(event) =>
					handleUpdateSort(index, { columnId: event.target.value })
				}
			>
				{columnOptionItems}
			</select>
			<select
				data-sort-direction={index}
				value={sort.direction}
				onChange={(event) =>
					handleUpdateSort(index, {
						direction: event.target.value as "asc" | "desc",
					})
				}
			>
				<option value="asc">Ascending</option>
				<option value="desc">Descending</option>
			</select>
			<button
				data-sort-move-up={index}
				onClick={() => handleMoveSort(index, "up")}
				disabled={index === 0}
			>
				↑
			</button>
			<button
				data-sort-move-down={index}
				onClick={() => handleMoveSort(index, "down")}
				disabled={index === sorts.length - 1}
			>
				↓
			</button>
			<button data-sort-remove={index} onClick={() => handleRemoveSort(index)}>
				×
			</button>
		</div>
	));

	return (
		<div className="pen-db-filter-panel" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<div className="pen-db-filter-header">
				<span>Sort</span>
				<button onClick={onClose}>×</button>
			</div>
			{sortRows}
			<button className="pen-db-sort-add" onClick={handleAddSort}>
				+ Add sort
			</button>
		</div>
	);
}

export function FilterPanel(props: {
	columnSchema: DatabaseColumnDef[];
	filterGroup: FilterGroup;
	facetBucketsByColumnId: Record<string, FacetBucket[]>;
	onChange: (filter: FilterGroup | null) => void;
	onClose: () => void;
}) {
	const { columnSchema, filterGroup, facetBucketsByColumnId, onChange, onClose } =
		props;

	const rootEditor = (
		<FilterGroupEditor
			columnSchema={columnSchema}
			facetBucketsByColumnId={facetBucketsByColumnId}
			rootFilterGroup={filterGroup}
			group={filterGroup}
			groupPath={[]}
			isRoot
			onChange={onChange}
		/>
	);

	return (
		<div className="pen-db-filter-panel" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<div className="pen-db-filter-header">
				<span>Filters</span>
				<button onClick={onClose}>×</button>
			</div>
			{rootEditor}
		</div>
	);
}

function FilterGroupEditor(props: {
	columnSchema: DatabaseColumnDef[];
	facetBucketsByColumnId: Record<string, FacetBucket[]>;
	rootFilterGroup: FilterGroup;
	group: FilterGroup;
	groupPath: FilterPath;
	isRoot?: boolean;
	onChange: (filter: FilterGroup | null) => void;
}) {
	const {
		columnSchema,
		facetBucketsByColumnId,
		rootFilterGroup,
		group,
		groupPath,
		isRoot = false,
		onChange,
	} = props;

	const groupPathKey = getFilterPathKey(groupPath);

	function handleGroupOperatorChange(operator: FilterGroup["operator"]) {
		const nextFilter = updateFilterGroupOperatorAtPath(
			rootFilterGroup,
			groupPath,
			operator,
		);
		onChange(nextFilter.conditions.length > 0 ? nextFilter : null);
	}

	function handleAddCondition() {
		const nextFilter = addFilterNodeAtPath(
			rootFilterGroup,
			groupPath,
			createDefaultFilterCondition(columnSchema),
		);
		onChange(nextFilter);
	}

	function handleAddGroup() {
		const nextFilter = addFilterNodeAtPath(rootFilterGroup, groupPath, {
			operator: "and",
			conditions: [createDefaultFilterCondition(columnSchema)],
		});
		onChange(nextFilter);
	}

	function handleRemoveGroup() {
		if (groupPath.length === 0) {
			onChange(null);
			return;
		}
		const nextFilter = removeFilterNodeAtPath(rootFilterGroup, groupPath);
		onChange(nextFilter.conditions.length > 0 ? nextFilter : null);
	}

	const childItems = group.conditions.map((condition, index) => {
		const childPath = [...groupPath, index];
		if (isFilterGroupNode(condition)) {
			return (
				<FilterGroupEditor
					key={getFilterPathKey(childPath)}
					columnSchema={columnSchema}
					facetBucketsByColumnId={facetBucketsByColumnId}
					rootFilterGroup={rootFilterGroup}
					group={condition}
					groupPath={childPath}
					onChange={onChange}
				/>
			);
		}
		return (
			<FilterConditionRow
				key={getFilterPathKey(childPath)}
				columnSchema={columnSchema}
				condition={condition}
				conditionPath={childPath}
				facetBucketsByColumnId={facetBucketsByColumnId}
				rootFilterGroup={rootFilterGroup}
				onChange={onChange}
			/>
		);
	});

	return (
		<div className="pen-db-filter-group" data-filter-group-path={groupPathKey}>
			<div className="pen-db-filter-group-header">
				<select
					data-filter-group-operator={groupPathKey}
					value={group.operator}
					onChange={(event) =>
						handleGroupOperatorChange(event.target.value as FilterGroup["operator"])
					}
				>
					<option value="and">AND</option>
					<option value="or">OR</option>
				</select>
				{!isRoot ? (
					<button
						data-filter-remove-group={groupPathKey}
						onClick={handleRemoveGroup}
					>
						×
					</button>
				) : null}
			</div>
			{childItems}
			<div className="pen-db-filter-group-actions">
				<button
					className={isRoot ? "pen-db-filter-add" : "pen-db-filter-add-condition"}
					data-filter-add-condition={groupPathKey}
					onClick={handleAddCondition}
				>
					+ Add filter
				</button>
				<button
					className="pen-db-filter-add-group"
					data-filter-add-group={groupPathKey}
					onClick={handleAddGroup}
				>
					+ Add filter group
				</button>
			</div>
		</div>
	);
}

function FilterConditionRow(props: {
	columnSchema: DatabaseColumnDef[];
	condition: FilterCondition;
	conditionPath: FilterPath;
	facetBucketsByColumnId: Record<string, FacetBucket[]>;
	rootFilterGroup: FilterGroup;
	onChange: (filter: FilterGroup | null) => void;
}) {
	const {
		columnSchema,
		condition,
		conditionPath,
		facetBucketsByColumnId,
		rootFilterGroup,
		onChange,
	} = props;

	const conditionPathKey = getFilterPathKey(conditionPath);
	const column =
		columnSchema.find((entry) => entry.id === condition.columnId) ?? columnSchema[0];
	const operatorOptions = operatorOptionsFor(column?.type ?? "text");
	const facetBuckets = facetBucketsByColumnId[condition.columnId] ?? [];
	const datalistId = `pen-db-filter-values-${conditionPathKey}`;

	const columnOptionItems = columnSchema.map((columnItem) => (
		<option key={columnItem.id} value={columnItem.id}>
			{columnItem.title}
		</option>
	));
	const operatorOptionItems = operatorOptions.map((option) => (
		<option key={option.value} value={option.value}>
			{option.label}
		</option>
	));
	const facetOptionItems = facetBuckets.map((bucket) => (
		<option key={bucket.value} value={bucket.value} label={`${bucket.label} (${bucket.count})`}>
			{bucket.label} ({bucket.count})
		</option>
	));

	function handleUpdateCondition(patch: Partial<FilterCondition>) {
		const nextFilter = updateFilterConditionAtPath(
			rootFilterGroup,
			conditionPath,
			patch,
		);
		onChange(nextFilter.conditions.length > 0 ? nextFilter : null);
	}

	function handleRemoveCondition() {
		const nextFilter = removeFilterNodeAtPath(rootFilterGroup, conditionPath);
		onChange(nextFilter.conditions.length > 0 ? nextFilter : null);
	}

	function handleDateRangeChange(index: 0 | 1, nextValue: string) {
		const currentValue = Array.isArray(condition.value)
			? condition.value
			: ["", ""];
		const nextRangeValue: string[] = [...currentValue];
		nextRangeValue[index] = nextValue;
		handleUpdateCondition({ value: nextRangeValue });
	}

	const checkboxValueControl = (
		<select
			data-filter-value={conditionPathKey}
			value={condition.operator === "is_unchecked" ? "unchecked" : "checked"}
			onChange={(event) => {
				handleUpdateCondition({
					operator:
						event.target.value === "unchecked"
							? "is_unchecked"
							: "is_checked",
					value: null,
				});
			}}
		>
			<option value="checked">Checked</option>
			<option value="unchecked">Unchecked</option>
		</select>
	);
	const relativeOptionItems = DATE_RELATIVE_FILTER_OPTIONS.map((option) => (
		<option key={option.value} value={option.value}>
			{option.label}
		</option>
	));
	const dateValueControl = !dateFilterNeedsValue(condition.operator) ? null : condition.operator === "is_relative" ? (
		<select
			data-filter-value={conditionPathKey}
			value={typeof condition.value === "string" ? condition.value : "today"}
			onChange={(event) => handleUpdateCondition({ value: event.target.value })}
		>
			{relativeOptionItems}
		</select>
	) : condition.operator === "is_between" ? (
		<div className="pen-db-filter-date-range">
			<input
				data-filter-value-start={conditionPathKey}
				type="date"
				value={getDateFilterRangeValue(condition.value, 0)}
				onChange={(event) => handleDateRangeChange(0, event.target.value)}
			/>
			<span>to</span>
			<input
				data-filter-value-end={conditionPathKey}
				type="date"
				value={getDateFilterRangeValue(condition.value, 1)}
				onChange={(event) => handleDateRangeChange(1, event.target.value)}
			/>
		</div>
	) : (
		<input
			data-filter-value={conditionPathKey}
			type="date"
			value={getDateFilterSingleValue(condition.value)}
			onChange={(event) => handleUpdateCondition({ value: event.target.value })}
		/>
	);
	const textValueControl = (
		<>
			<input
				data-filter-value={conditionPathKey}
				type="text"
				list={facetBuckets.length > 0 ? datalistId : undefined}
				value={typeof condition.value === "string" ? condition.value : ""}
				onChange={(event) => handleUpdateCondition({ value: event.target.value })}
				placeholder="Filter value…"
			/>
			{facetBuckets.length > 0 ? (
				<datalist id={datalistId}>{facetOptionItems}</datalist>
			) : null}
		</>
	);
	const valueControl =
		column?.type === "checkbox"
			? checkboxValueControl
			: column?.type === "date"
				? dateValueControl
				: operatorNeedsValue(condition.operator)
					? textValueControl
					: null;

	return (
		<div className="pen-db-filter-row" data-filter-condition-path={conditionPathKey}>
			<select
				data-filter-column={conditionPathKey}
				value={condition.columnId}
				onChange={(event) => {
					const nextColumn = columnSchema.find(
						(entry) => entry.id === event.target.value,
					);
					handleUpdateCondition({
						columnId: event.target.value,
						operator: defaultOperatorFor(nextColumn?.type ?? "text"),
						value: getDefaultFilterValue(nextColumn?.type ?? "text"),
					});
				}}
			>
				{columnOptionItems}
			</select>
			<select
				data-filter-operator={conditionPathKey}
				value={condition.operator}
				onChange={(event) =>
					handleUpdateCondition({
						operator: event.target.value as FilterOperator,
						value: getDefaultFilterValueForOperator(
							column?.type ?? "text",
							event.target.value as FilterOperator,
						),
					})
				}
			>
				{operatorOptionItems}
			</select>
			{valueControl}
			<button data-filter-remove={conditionPathKey} onClick={handleRemoveCondition}>
				×
			</button>
		</div>
	);
}

export function ColumnVisibilityPanel(props: {
	columnSchema: DatabaseColumnDef[];
	visibleColumnIds: ReadonlySet<string>;
	onToggle: (columnId: string) => void;
	onClose: () => void;
}) {
	const { columnSchema, visibleColumnIds, onToggle, onClose } = props;

	const items = columnSchema.map((column) => (
		<label key={column.id} className="pen-db-col-vis-item">
			<input
				type="checkbox"
				checked={visibleColumnIds.has(column.id)}
				onChange={() => onToggle(column.id)}
			/>
			{column.title}
		</label>
	));

	return (
		<div className="pen-db-col-vis-panel" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<div className="pen-db-col-vis-header">
				<span>Columns</span>
				<button onClick={onClose}>×</button>
			</div>
			{items}
		</div>
	);
}

export function GroupPanel(props: {
	columnSchema: DatabaseColumnDef[];
	groupBy: string | null;
	onChange: (columnId: string | null) => void;
	onClose: () => void;
}) {
	const { columnSchema, groupBy, onChange, onClose } = props;

	const groupOptionItems = [
		<option key="none" value="">
			No grouping
		</option>,
		...columnSchema.map((column) => (
			<option key={column.id} value={column.id}>
				{column.title}
			</option>
		)),
	];

	return (
		<div className="pen-db-col-vis-panel" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<div className="pen-db-col-vis-header">
				<span>Group rows</span>
				<button onClick={onClose}>×</button>
			</div>
			<select value={groupBy ?? ""} onChange={(event) => onChange(event.target.value || null)}>
				{groupOptionItems}
			</select>
		</div>
	);
}

function isFilterGroupNode(value: FilterNode): value is FilterGroup {
	return "conditions" in value;
}
