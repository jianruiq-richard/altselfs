// Never accept a caller-supplied redirect origin. Only an opaque Desktop request ID travels here.
export function desktopRegistrationRequest(value: unknown): string | null {
  return typeof value === 'string' && /^auth_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export function desktopRegistrationReturn(request: string): string {
  const id = desktopRegistrationRequest(request);
  if (!id) throw new Error('Invalid desktop sign-in request.');
  return `https://desktop.minaco.ai/connect?${new URLSearchParams({ request: id, registered: '1' })}`;
}
