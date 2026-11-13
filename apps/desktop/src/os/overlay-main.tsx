import ReactDOM from "react-dom/client";
import { OsOverlayApp } from "./OsOverlayApp";

// agent 覆盖层窗口独立入口（vite 多页构建，见根目录 overlay.html）：极简
// React 树，不引入主应用的 Provider / 样式 / 消息流——加载快、内存小，
// 且主应用的启动屏/引导逻辑不会出现在覆盖层窗口里。
ReactDOM.createRoot(document.getElementById("root")!).render(<OsOverlayApp />);
