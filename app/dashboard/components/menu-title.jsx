import { ScaleIcon, WeightIcon } from "lucide-react";

function MenuTitle() {
  return (
    <h4 className="flex items-center gap-2">
      <ScaleIcon size={30} className="text-primary" />{" "}
      <div className="max-lg:hidden">Kilo Sahihi</div>
    </h4>
  );
}

export default MenuTitle;
