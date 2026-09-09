import { createServerFn } from "@tanstack/react-start";

export const officerLogin = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { loginOfficer } = await import("./officer.server");
    return loginOfficer(data.username, data.password);
  });

export const officerSession = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { readOfficerSession } = await import("./officer.server");
    return readOfficerSession(data.token);
  });
