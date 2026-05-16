import type React from "react";

export function RefreshIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
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
        d="M3.5 10C3.5 6.41015 6.41015 3.5 10 3.5C12.1159 3.5 14.0038 4.56148 15.1836 6.2094M16.5 10C16.5 13.5899 13.5899 16.5 10 16.5C7.88413 16.5 5.99624 15.4385 4.81644 13.7906M16.5 3.5V7.5H12.5M3.5 16.5V12.5H7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
