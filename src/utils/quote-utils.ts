export function supportsNativeQuote(): boolean {
  return true;
}

export function getPostQuoteApprovalPolicy(
  quoteApproval: Record<string, unknown> | null | undefined,
): string {
  const k = (quoteApproval?.currentUser as string | undefined) ?? '';
  const entry = quoteApproval?.[k] as { [i: number]: string } | undefined;
  return entry?.[0] || 'nobody';
}
