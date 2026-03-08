import type { IconProps } from "./types";

export function IconLink({
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
				d="M5.75 8.25L8.25 5.75"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				fill="none"
			/>
			<path
				d="M6.5 9.5L5.414 10.586C4.633 11.367 3.367 11.367 2.586 10.586V10.586C1.805 9.805 1.805 8.539 2.586 7.758L3.672 6.672"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				fill="none"
			/>
			<path
				d="M7.5 4.5L8.586 3.414C9.367 2.633 10.633 2.633 11.414 3.414V3.414C12.195 4.195 12.195 5.461 11.414 6.242L10.328 7.328"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				fill="none"
			/>
		</svg>
	);
}
