import ReactDOM from "react-dom/client";
import { PetWindowApp } from "./PetWindowApp";

// 桌面宠物窗口的独立入口。不引入主应用，主窗口失焦或收到托盘时这页仍在自己的窗口里渲染。
ReactDOM.createRoot(document.getElementById("root")!).render(<PetWindowApp />);
