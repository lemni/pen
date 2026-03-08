import type { IconProps } from "./types";

export function IconChain({
	size = 14,
	color = "currentColor",
	className,
}: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox="0 0 14 14"
			className={className}
		>
			<path
				d="M 8.5 5.5 L 5.5 8.5 M 6.297 2.76 L 6.651 2.406 C 8.018 1.039 10.234 1.039 11.601 2.406 C 12.968 3.773 12.968 5.989 11.601 7.356 C 10.234 8.722 11.247 7.709 11.247 7.709 M 2.754 6.302 L 2.4 6.656 C 1.033 8.023 1.033 10.239 2.4 11.606 C 3.767 12.973 5.983 12.973 7.35 11.606 L 7.704 11.252"
				fill="transparent"
				strokeWidth="1.5"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
