// "use client";

// import {
//   SidebarGroup,
//   SidebarGroupContent,
//   SidebarMenu,
//   SidebarMenuButton,
//   SidebarMenuItem,
// } from "@/components/ui/sidebar";
// import { cn } from "@/lib/utils";
// import Link from "next/link";
// import { usePathname } from "next/navigation";

// export function NavMain({ items }) {
//   const pathname = usePathname();

//   const isActive = (url) => {
//     return pathname === url;
//   };

//   return (
//     <SidebarGroup>
//       <SidebarGroupContent className="flex flex-col gap-2">
//         <SidebarMenu>
//           {items.map((item) => (
//             <SidebarMenuItem key={item.title}>
//               <SidebarMenuButton
//                 tooltip={item.title}
//                 asChild
//                 isActive={isActive(item.url)}
//                 className={cn(
//                   "transition-colors duration-200",
//                   isActive(item.url) && [
//                     "bg-primary text-primary-foreground",
//                     "hover:bg-primary hover:text-primary-foreground",
//                     "dark:bg-primary dark:text-primary-foreground",
//                     "font-semibold",
//                     "border-l-4 border-primary",
//                   ]
//                 )}
//               >
//                 <Link
//                   href={item.url}
//                   className="flex items-center gap-2 w-full"
//                 >
//                   {item.icon && <item.icon className="h-4 w-4" />}
//                   <span>{item.title}</span>
//                 </Link>
//               </SidebarMenuButton>
//             </SidebarMenuItem>
//           ))}
//         </SidebarMenu>
//       </SidebarGroupContent>
//     </SidebarGroup>
//   );
// }
