
let allowed = false;

export function allowOneSignup(): void {
  allowed = true;
}

export function consumeSignupPermission(): boolean {
  if (!allowed) return false;
  allowed = false;
  return true;
}
