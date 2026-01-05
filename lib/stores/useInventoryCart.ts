// // lib/stores/useInventoryCart.ts
// import { create } from "zustand";

// type Item = {
//   id: string;
//   name: string;

//   quantity: number;
// };

// type InventoryCartState = {
//   items: Item[];
//   addItem: (item: Item) => void;
//   removeItem: (id: string) => void;

//   clearCart: () => void;
// };

// export const useInventoryCart = create<InventoryCartState>((set) => ({
//   items: [],
//   addItem: (item) => set((state) => ({ items: [...state.items, item] })),
//   removeItem: (id) =>
//     set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

//   clearCart: () => set({ items: [] }),
// }));
