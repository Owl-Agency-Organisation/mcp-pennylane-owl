// Garde-fous metier sur les ecritures de la liste blanche. Appliques dans
// callOperation, point de passage unique des niveaux 1 et 3 : aucun outil ne
// peut les contourner.
//
// Factures clients : brouillons uniquement. Une facture finalisee porte un
// numero definitif et une ecriture comptable ; elle ne s'annule que par un
// avoir. La finalisation se fait a la main dans Pennylane.

export class GuardError extends Error {}

// Creations qui finaliseraient la facture sans `draft: true` explicite.
// Pour postCustomerInvoices, un corps sans `draft` correspond a la variante
// finalisee du schema : l'absence vaut finalisation, d'ou l'exigence d'un
// `true` explicite.
export const DRAFT_ONLY_CREATIONS = new Set(['postCustomerInvoices', 'createCustomerInvoiceFromQuote']);

// Operations sur une facture existante : permises seulement si elle est
// encore en brouillon, ce qui est verifie en la relisant avant l'appel.
export const DRAFT_ONLY_TARGETS = new Set(['updateCustomerInvoice', 'deleteCustomerInvoices']);

// `readInvoice(id)` renvoie la facture telle que la lit GET /customer_invoices/{id}.
export async function enforceWriteGuards(operation, { pathParams = {}, body } = {}, { readInvoice }) {
  const id = operation.operation_id;

  if (DRAFT_ONLY_CREATIONS.has(id) && body?.draft !== true) {
    throw new GuardError(
      `${id} refusée : seules les factures en brouillon peuvent être créées (draft: true requis). `
      + 'La finalisation se fait dans Pennylane.',
    );
  }

  if (DRAFT_ONLY_TARGETS.has(id)) {
    const invoice = await readInvoice(pathParams.id);
    if (invoice?.draft !== true) {
      throw new GuardError(
        `${id} refusée : la facture ${pathParams.id} n'est pas un brouillon `
        + `(statut ${invoice?.status ?? 'inconnu'}${invoice?.invoice_number ? `, n° ${invoice.invoice_number}` : ''}). `
        + 'Une facture finalisée se corrige par un avoir, dans Pennylane.',
      );
    }
  }
}
