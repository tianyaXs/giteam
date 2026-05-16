import type React from "react";

export function SparklesIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M8 1L9.5 5.5L14 7L9.5 8.5L8 13L6.5 8.5L2 7L6.5 5.5L8 1Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M13 9L13.75 11.25L16 12L13.75 12.75L13 15L12.25 12.75L10 12L12.25 11.25L13 9Z"
        fill="currentColor"
        opacity="0.65"
      />
    </svg>
  );
}
