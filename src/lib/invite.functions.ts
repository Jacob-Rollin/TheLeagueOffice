import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(2).max(40),
  displayName: z.string().min(1).max(60),
  inviteCode: z.string().min(1).max(120),
});

export const signUpWithInviteCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { signUpWithInvite } = await import("./invite.server");
    return await signUpWithInvite(data);
  });
