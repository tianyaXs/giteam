import type React from "react";

export function ArrowDownIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10 4V16M10 16L5 11M10 16L15 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function CheckIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 10.5L8 14.5L16 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M5 8L10 13L15 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function ChevronRightIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M8 5L13 10L8 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function CopyIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M7.25 3.5H12.25C13.6307 3.5 14.75 4.61929 14.75 6V11C14.75 12.3807 13.6307 13.5 12.25 13.5H7.25C5.86929 13.5 4.75 12.3807 4.75 11V6C4.75 4.61929 5.86929 3.5 7.25 3.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 16.5H11.75C13.1307 16.5 14.25 15.3807 14.25 14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function CloseIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="21" viewBox="0 0 21 21" width="21" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M14.6549 5.57307C14.9283 5.2997 15.3718 5.2997 15.6451 5.57307C15.9185 5.84643 15.9185 6.28993 15.6451 6.5633L11.3903 10.8182L15.6451 15.0731L15.735 15.1834C15.9141 15.4551 15.8842 15.8242 15.6451 16.0633C15.4061 16.3024 15.0369 16.3322 14.7653 16.1531L14.6549 16.0633L10.4 11.8084L6.14515 16.0633C5.87178 16.3367 5.42828 16.3367 5.15492 16.0633C4.88155 15.7899 4.88155 15.3464 5.15492 15.0731L9.4098 10.8182L5.15492 6.5633L5.06507 6.45295C4.88597 6.18128 4.91584 5.81214 5.15492 5.57307C5.39399 5.33399 5.76313 5.30413 6.0348 5.48322L6.14515 5.57307L10.4 9.82795L14.6549 5.57307Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function EditIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M2.6687 11.333V8.66699C2.6687 7.74455 2.66841 7.01205 2.71655 6.42285C2.76533 5.82612 2.86699 5.31731 3.10425 4.85156L3.25854 4.57617C3.64272 3.94975 4.19392 3.43995 4.85229 3.10449L5.02905 3.02149C5.44666 2.84233 5.90133 2.75849 6.42358 2.71582C7.01272 2.66769 7.74445 2.66797 8.66675 2.66797H9.16675C9.53393 2.66797 9.83165 2.96586 9.83179 3.33301C9.83179 3.70028 9.53402 3.99805 9.16675 3.99805H8.66675C7.7226 3.99805 7.05438 3.99834 6.53198 4.04102C6.14611 4.07254 5.87277 4.12568 5.65601 4.20313L5.45581 4.28906C5.01645 4.51293 4.64872 4.85345 4.39233 5.27149L4.28979 5.45508C4.16388 5.7022 4.08381 6.01663 4.04175 6.53125C3.99906 7.05373 3.99878 7.7226 3.99878 8.66699V11.333C3.99878 12.2774 3.99906 12.9463 4.04175 13.4688C4.08381 13.9833 4.16389 14.2978 4.28979 14.5449L4.39233 14.7285C4.64871 15.1465 5.01648 15.4871 5.45581 15.7109L5.65601 15.7969C5.87276 15.8743 6.14614 15.9265 6.53198 15.958C7.05439 16.0007 7.72256 16.002 8.66675 16.002H11.3337C12.2779 16.002 12.9461 16.0007 13.4685 15.958C13.9829 15.916 14.2976 15.8367 14.5447 15.7109L14.7292 15.6074C15.147 15.3511 15.4879 14.9841 15.7117 14.5449L15.7976 14.3447C15.8751 14.128 15.9272 13.8546 15.9587 13.4688C16.0014 12.9463 16.0017 12.2774 16.0017 11.333V10.833C16.0018 10.466 16.2997 10.1681 16.6667 10.168C17.0339 10.168 17.3316 10.4659 17.3318 10.833V11.333C17.3318 12.2555 17.3331 12.9879 17.2849 13.5771C17.2422 14.0993 17.1584 14.5541 16.9792 14.9717L16.8962 15.1484C16.5609 15.8066 16.0507 16.3571 15.4246 16.7412L15.1492 16.8955C14.6833 17.1329 14.1739 17.2354 13.5769 17.2842C12.9878 17.3323 12.256 17.332 11.3337 17.332H8.66675C7.74446 17.3323 7.01271 17.3323 6.42358 17.2842C5.90135 17.2415 5.44665 17.1577 5.02905 16.9785L4.85229 16.8955C4.19396 16.5601 3.64271 16.0502 3.25854 15.4238L3.10425 15.1484C2.86697 14.6827 2.76534 14.1739 2.71655 13.5771C2.66841 12.9879 2.6687 12.2555 2.6687 11.333ZM13.4646 3.11328C14.4201 2.334 15.8288 2.38969 16.7195 3.28027L16.8865 3.46485C17.6141 4.35685 17.6143 5.64423 16.8865 6.53613L16.7195 6.7207L11.6726 11.7686C11.1373 12.3039 10.4624 12.6746 9.72827 12.8408L9.41089 12.8994L7.59351 13.1582C7.38637 13.1877 7.17701 13.1187 7.02905 12.9707C6.88112 12.8227 6.81199 12.6134 6.84155 12.4063L7.10132 10.5898L7.15991 10.2715C7.3262 9.53749 7.69692 8.86241 8.23218 8.32715L13.2791 3.28027L13.4646 3.11328ZM15.7791 4.2207C15.3753 3.81702 14.7366 3.79124 14.3035 4.14453L14.2195 4.2207L9.17261 9.26856C8.81541 9.62578 8.56774 10.0756 8.45679 10.5654L8.41772 10.7773L8.28296 11.7158L9.22241 11.582L9.43433 11.543C9.92426 11.432 10.3749 11.1844 10.7322 10.8271L15.7791 5.78027L15.8552 5.69629C16.185 5.29194 16.1852 4.708 15.8552 4.30371L15.7791 4.2207Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FolderIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M2.5 6.25C2.5 4.86929 3.61929 3.75 5 3.75H7.442C8.10504 3.75 8.74093 4.01339 9.20971 4.48223L10.25 5.5225C10.4844 5.75693 10.8024 5.88861 11.1339 5.88861H15C16.3807 5.88861 17.5 7.0079 17.5 8.38861V13.75C17.5 15.1307 16.3807 16.25 15 16.25H5C3.61929 16.25 2.5 15.1307 2.5 13.75V6.25ZM5 5C4.30964 5 3.75 5.55964 3.75 6.25V7.13861H16.25C15.921 6.82494 15.4802 6.63861 15 6.63861H11.1339C10.4708 6.63861 9.83496 6.37522 9.36618 5.90638L8.32589 4.86612C8.09146 4.63169 7.77352 4.5 7.442 4.5H5ZM3.75 8.38861V13.75C3.75 14.4404 4.30964 15 5 15H15C15.6904 15 16.25 14.4404 16.25 13.75V8.38861H3.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ImageIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
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

export function MenuIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 6H16M4 10H16M4 14H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function MinusIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 10H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function MoreHorizontalIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="4" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="16" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function PinIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M12.7143 3.25C12.9934 3.25 13.2559 3.38163 13.4223 3.60547L15.8647 6.88867C16.1022 7.20811 16.0691 7.65221 15.7866 7.93262L13.8335 9.87012V12.4375C13.8335 12.7423 13.6869 13.0285 13.439 13.2061C13.191 13.3837 12.8726 13.4305 12.5835 13.332L10.8579 12.7461L8.45654 16.75L7.64209 16.2617L10.0415 12.2617L9.12939 10.6855C8.97518 10.4193 8.96653 10.0926 9.10693 9.81836C9.24732 9.5441 9.51696 9.36088 9.82471 9.33496L12.8579 9.08105L14.0591 7.89062L12.2378 5.44238L8.27686 5.96094L6.3208 7.90137L8.6792 11.0703L7.92725 11.6299L5.20654 7.97363C4.96893 7.65429 5.00198 7.21014 5.28467 6.92969L7.44678 4.78613C7.59288 4.64126 7.78375 4.55052 7.98779 4.52832L12.5981 3.25293L12.7143 3.25Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M11.1768 9.23242L13.832 11.8877" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  );
}

export function StarIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M10.0004 3.08398L12.1166 7.37109L16.848 8.05957L13.4241 11.3965L14.2327 16.1094L10.0004 13.8848L5.76899 16.1094L6.57661 11.3965L3.15376 8.05957L7.88521 7.37109L10.0004 3.08398Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function PlusIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10 4V16M4 10H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function RefreshIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
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

export function SyncIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M5 7.5L5 12.5M5 12.5L3 10.5M5 12.5L7 10.5M15 12.5V7.5M15 7.5L13 9.5M15 7.5L17 9.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
