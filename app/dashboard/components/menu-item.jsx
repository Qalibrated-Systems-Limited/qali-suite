// "use client";
// import { DrawerContext } from "@/components/ui/drawer";
// import { cn } from "../../../lib/utils";

// import Link from "next/link";
// import { usePathname } from "next/navigation";
// import { useContext } from "react";

// function MenuItem({ href, title, Icon }) {
//   const pathName = usePathname();
//   const isActive = pathName === href;
//   const { onClose } = useContext(DrawerContext);
//   return (
//     <Link
//       onClick={onClose}
//       className={cn(
//         "p-2 hover:bg-white flex gap-2 items-center dark:hover:bg-zinc-700 rounded-md text-muted-foreground hover:text-foreground",
//         isActive &&
//           "bg-primary hover:bg-primary dark:hover:bg-primary hover:text-foreground  text-white dark:text-foreground"
//       )}
//       href={href}
//     >
//       <Icon />
//       {title}
//     </Link>
//   );
// }

// export default MenuItem;
