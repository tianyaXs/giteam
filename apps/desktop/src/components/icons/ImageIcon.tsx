import type React from "react";

export function ImageIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
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
        d="M3 14.5L7 9.5L11.5 13.5L15.5 8.5M17 4.5V15.5C17 16.6046 16.1046 17.5 15 17.5H5C3.89543 17.5 3 16.6046 3 15.5V4.5C3 3.39543 3.89543 2.5 5 2.5H15C16.1046 2.5 17 3.39543 17 4.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="13" cy="6.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
