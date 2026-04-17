type MaskableRow = Record<string, unknown>;

export function applyMasking(
  data: MaskableRow | MaskableRow[] | unknown,
  userLevel: string,
  role: string,
): MaskableRow | MaskableRow[] | unknown {
  if (role === 'super_admin' || role === 'admin') return data;

  const sensitiveFields = [
    'gross_margin',
    'margin_pct',
    'avg_margin',
    'avg_margin_pct',
    'unit_cost',
    'cost_of_goods',
    'spend',
    'total_spend',
    'roas',
    'avg_roas',
    'cpc',
    'avg_cpc',
    'cpa',
  ];

  if (userLevel === 'viewer') {
    if (Array.isArray(data)) {
      return data.map((row) => maskRow(row, sensitiveFields, true));
    }
    return maskRow(data, sensitiveFields, true);
  }

  // analyst and manager get full data
  return data;
}

function maskRow(row: unknown, fields: string[], maskEmails: boolean): unknown {
  if (!row || typeof row !== 'object') return row;
  const result: MaskableRow = { ...(row as MaskableRow) };
  for (const f of fields) {
    if (f in result) result[f] = null;
  }
  if (maskEmails && typeof result.email === 'string') {
    result.email = maskEmail(result.email);
  }
  return result;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  return local.slice(0, 2) + '•••@' + domain;
}
