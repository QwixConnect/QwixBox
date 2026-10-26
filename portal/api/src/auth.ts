import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { db } from "./db";
import * as schema from "./db/auth-schema";
import { env } from "./env";
import { sendMail } from "./lib/mail";
import { consumeSignupPermission } from "./lib/signup-gate";

const statement = {
  extension: ["create", "read", "update", "delete"],
  trunk: ["create", "read", "update", "delete"],
  route: ["create", "read", "update", "delete"],
  callflow: ["create", "read", "update", "delete"],
  cdr: ["read", "export"],
  recording: ["read", "delete"],
  tenant: ["read", "update"],
  audit: ["read"],
} as const;

const ac = createAccessControl(statement);

const viewer = ac.newRole({
  extension: ["read"],
  trunk: ["read"],
  route: ["read"],
  callflow: ["read"],
  cdr: ["read"],
  tenant: ["read"],
});

const member = ac.newRole({
  extension: ["create", "read", "update", "delete"],
  trunk: ["read"],
  route: ["read"],
  callflow: ["create", "read", "update", "delete"],
  cdr: ["read"],
  recording: ["read"],
  tenant: ["read"],
});

const admin = ac.newRole({
  extension: ["create", "read", "update", "delete"],
  trunk: ["create", "read", "update", "delete"],
  route: ["create", "read", "update", "delete"],
  callflow: ["create", "read", "update", "delete"],
  cdr: ["read", "export"],
  recording: ["read", "delete"],
  tenant: ["read", "update"],
  audit: ["read"],
});

const owner = ac.newRole({
  extension: ["create", "read", "update", "delete"],
  trunk: ["create", "read", "update", "delete"],
  route: ["create", "read", "update", "delete"],
  callflow: ["create", "read", "update", "delete"],
  cdr: ["read", "export"],
  recording: ["read", "delete"],
  tenant: ["read", "update"],
  audit: ["read"],
});

export const ROLES = { owner, admin, member, viewer } as const;
export type RoleName = keyof typeof ROLES;

export const auth = betterAuth({
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Membership mutations go through the serialized service, including owner checks.
      if (
        [
          "/organization/add-member",
          "/organization/update-member-role",
          "/organization/remove-member",
          "/organization/leave",
          "/organization/invite-member",
          "/organization/accept-invitation",
          "/organization/delete",
        ].includes(ctx.path)
      ) {
        throw new APIError("FORBIDDEN", {
          message: "Use the tenant membership API",
        });
      }
    }),
  },
  database: drizzleAdapter(db, { provider: "pg", schema }),

  secret: env.authSecret,
  baseURL: `https://${env.pbxFqdn}`,
  basePath: "/api/auth",

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,

    async sendResetPassword({ user, url }) {
      const sent = await sendMail({
        to: user.email,
        subject: "Reset your QwixBox password",
        tag: "auth",
        text:
          `Someone asked to reset the password for ${user.email} on ${env.pbxFqdn}.\n\n` +
          `${url}\n\n` +
          `The link expires in one hour and can be used once.\n\n` +
          `If this was not you, nothing has changed and you can ignore this message.\n`,
      });

      if (!sent) {
        console.error(
          `[auth] could not email a reset link to ${user.email}. ` +
            `Check the MTA (steps/15-mail.sh) - the link was not delivered.`,
        );
      }
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          if (!consumeSignupPermission()) {
            console.warn(`[auth] rejected signup attempt for ${newUser.email}`);
            throw new APIError("BAD_REQUEST", {
              message:
                "Registration is not open. Accounts are created by the operator.",
            });
          }
          return { data: newUser };
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  trustedOrigins: [`https://${env.pbxFqdn}`],

  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-real-ip"],
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 300, max: 10 },
      // The path the portal's requestPasswordReset() calls. This rule used to name
      // "/forget-password", which nothing here requests, so it limited nothing (I21).
      "/request-password-reset": { window: 300, max: 5 },
    },
  },

  plugins: [
    organization({
      ac,
      roles: { owner, admin, member, viewer },
      allowUserToCreateOrganization: false, // tenants are provisioned, not self-served
      organizationLimit: 1,
      creatorRole: "owner",
      async sendInvitationEmail(data) {
        console.warn(
          `[auth] invitation delivery is unavailable for organization ${data.organization.id}`,
        );
      },
    }),
  ],
});

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"];
