import {
  ComputerIcon,
  ScaleIcon,
  StoreIcon,
  WeightIcon,
  WorkflowIcon,
} from "lucide-react";

function MenuTitle() {
  return (
    <h4 className="flex items-center gap-2">
      <ComputerIcon size={30} className="text-primary" />{" "}
      <div className="max-lg:hidden">QaliSuite</div>
    </h4>
  );
}

export default MenuTitle;
