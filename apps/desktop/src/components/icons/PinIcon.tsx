import type React from "react";

export function PinIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12.5 2.5L7.5 7.5L4.5 7.5C3.94772 7.5 3.5 7.94772 3.5 8.5C3.5 9.05228 3.94772 9.5 4.5 9.5L9.5 9.5L9.5 14.5C9.5 15.0523 9.94772 15.5 10.5 15.5C11.0523 15.5 11.5 15.0523 11.5 14.5L11.5 11.5L16.5 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
