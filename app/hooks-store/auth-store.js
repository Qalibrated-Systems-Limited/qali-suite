import { initStore } from "./store";

export const configureAuthStore = () => {
  const actions = {
    LOGIN: (curState, authResult) => {
      return { authResult: { ...authResult } };
    },

    LOGOUT: (curState, p) => {
      return { authResult: { isLoggedIn: p } };
    },
  };
  initStore(actions, null);
};
