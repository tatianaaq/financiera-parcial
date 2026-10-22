import type { Loan } from '../types/models';

// El documento que identifica al prestatario es el que se utilizó al originar el crédito.
// El DNI se mantiene separado para la política interna de riesgo; no sustituye al RUC.
export function loanIdentity(loan: Loan) {
  const isRuc10 = loan.documentType === 'RUC10';
  const isRuc20 = loan.documentType === 'RUC20';
  const isRuc = isRuc10 || isRuc20;
  const name = isRuc20 ? (loan.companyName?.trim() || loan.client) : loan.client;
  const document = isRuc
    ? `${isRuc10 ? 'RUC 10' : 'RUC 20'} ${loan.borrowerDocument?.trim() || '(no disponible)'}`
    : `DNI ${loan.borrowerDocument?.trim() || loan.dni}`;
  const responsibleDni = loan.responsibleDni?.trim() || loan.dni;
  return {
    name,
    document,
    responsibleDni,
    isRuc,
    isRuc20,
    representative: isRuc20 ? loan.representativeName?.trim() : undefined,
  };
}
