import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

import { cn } from "../../lib/utils";

function ItemSelect({ handleSelectType, className, items, name }) {
  return (
    <div className={cn(className, "w-full")} key={name}>
      <Select
        onValueChange={(e) => handleSelectType(e)}
        name="items"
        defaultValue="All"
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${name}`} />
        </SelectTrigger>

        <SelectContent className="w-full">
          <SelectItem value="_">No selection</SelectItem>
          <SelectItem value="All">All</SelectItem>
          {...items.map((station) => (
            <SelectItem key={station._id} value={station.name}>
              {station.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export { ItemSelect };
