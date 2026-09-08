export function legalProfile(env: NodeJS.ProcessEnv = process.env) {
  const name = env.LEGAL_SELLER_NAME?.trim();
  const inn = env.LEGAL_SELLER_INN?.trim();
  const address = env.LEGAL_CONTACT_ADDRESS?.trim();
  return {
    // Explicit publishing choice: never borrow NPD credentials or the account
    // holder's name from another project to fill public documents.
    published: env.LEGAL_DOCUMENTS_PUBLISHED === "true" && Boolean(name && inn && /^\d{12}$/u.test(inn) && address),
    name, inn, address
  };
}
