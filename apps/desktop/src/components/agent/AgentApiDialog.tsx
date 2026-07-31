import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

type AgentApiDialogProps = {
  port: number;
  onClose: () => void;
  onPortChange: (port: number) => void;
};

export function AgentApiDialog(props: AgentApiDialogProps) {
  void props.port;
  void props.onPortChange;
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) props.onClose();
    }}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Giteam Agent</DialogTitle>
          <DialogDescription className="text-[15px] leading-7">
            Agent 已在桌面进程内通过 pi SDK 运行，无需配置本地服务端口。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
