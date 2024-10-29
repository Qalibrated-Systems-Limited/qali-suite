const { useState, useEffect } = require("react");

let globalState = {};
let listeners = [() => {}];
let actions = {};

export const useStore = () => {
  const setState = useState[1];

  const dispatch = (actionIdentifier, payload) => {
    console.log(actions[actionIdentifier]);
    if (typeof actions[actionIdentifier] === "function") {
      console.log("ok");
      const newState = actions[actionIdentifier](globalState, payload);
      globalState = { ...globalState, ...newState };
    }

    for (let listener of listeners) {
      if (typeof listener === "function") {
        listener(globalState);
      }
    }
  };

  useEffect(() => {
    listeners.push(setState);
    return () => {
      listeners = listeners.filter((listener) => listener !== setState);
    };
  }, [setState]);

  return [globalState, dispatch];
};

export const initStore = (specificAction, intialState) => {
  if (intialState) {
    globalState = { ...globalState, ...intialState };
  }

  actions = { ...actions, ...specificAction };
};
