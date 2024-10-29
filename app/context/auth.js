"use client";

import { createContext, useState, useEffect } from "react";

const authContext = createContext({
  login: (token, user) => {},
  token: "",
  isLoggedIn: false,
  logout: () => {},
  user: { email: "", name: "", role: "" },
  role: "",
});
function AuthProvider({ children }) {
  const [token, setToken] = useState("");

  const [user, setUser] = useState({});
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const login = (token, user) => {
    setUser(user);
    setToken(token);
  };

  useEffect(() => {
    const tokenn = localStorage.getItem("token");
    console.log(tokenn);
    const userName = localStorage.getItem("userName");
    const userId = localStorage.getItem("userId");
    const role = localStorage.getItem("role");
    const email = localStorage.getItem("email");
    setToken(tokenn);
    setIsLoggedIn((val) => tokenn && tokenn.length > 5);
    setUser({ name: userName, id: userId, role: role, email: email });
  }, [setIsLoggedIn, token, isLoggedIn]);

  const logout = () => {
    localStorage.clear();
    setToken();
    setUser({});
  };

  return (
    <authContext.Provider
      value={{
        user: user,

        token: token,
        login: login,

        logout: logout,
        isLoggedIn: isLoggedIn,
      }}>
      {children}
    </authContext.Provider>
  );
}
export default AuthProvider;
export { authContext };
