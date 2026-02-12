import { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface User extends DefaultUser {
    role?: string;
    companyId?: string;
    companyCode?: string;
  }

  interface Session extends DefaultSession {
    user: User;
  }
}
