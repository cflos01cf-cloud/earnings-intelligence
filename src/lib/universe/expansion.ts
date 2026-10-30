/**
 * Ampliación del universo: acciones medianas de EE.UU. (en su mayoría del S&P MidCap 400 y algunas del
 * SmallCap 600), donde la reacción a resultados suele ser menos eficiente que en las 35 gigantes de GBM.
 *
 * Lista CURADA a mano (no es la composición oficial de ningún índice, que cambia cada trimestre):
 *  - Emisores que presentan 10-Q/10-K (sin ADRs ni emisores extranjeros).
 *  - Sin REITs: reportan FFO, no un EPS comparable.
 *  - Sin empresas con fusión o compra anunciada a la fecha de la lista.
 * La ingesta valida cada símbolo (CIK en la SEC y precios en TwelveData); los que fallen quedan marcados
 * en Ajustes, nunca se inventan.
 *
 * Sesgo de supervivencia: son empresas que existen hoy. El backtest lo declara.
 * Fecha de la lista: 2026-10-30. Se activa/desactiva con UNIVERSE_EXPANSION (on por defecto).
 */
import type { SeedRow } from './seed';

const S = (sector: string, rows: [string, string][]): SeedRow[] => rows.map(([symbol, name]) => [symbol, name, 'US', sector, 'stock', 'US']);

export const EXPANSION_LIST_DATE = '2026-10-30';

export const EXPANSION: SeedRow[] = [
  ...S('Industrials', [
    ['AYI', 'Acuity'], ['ACM', 'AECOM'], ['AGCO', 'AGCO'], ['ALK', 'Alaska Air Group'], ['AIT', 'Applied Industrial Technologies'],
    ['BWXT', 'BWX Technologies'], ['CW', 'Curtiss-Wright'], ['DCI', 'Donaldson'], ['GGG', 'Graco'], ['ITT', 'ITT'],
    ['KBR', 'KBR'], ['KNX', 'Knight-Swift Transportation'], ['LECO', 'Lincoln Electric'], ['LSTR', 'Landstar System'], ['MSA', 'MSA Safety'],
    ['MTZ', 'MasTec'], ['OSK', 'Oshkosh'], ['RBC', 'RBC Bearings'], ['RRX', 'Regal Rexnord'], ['SAIA', 'Saia'],
    ['SSD', 'Simpson Manufacturing'], ['TTC', 'Toro'], ['TKR', 'Timken'], ['UFPI', 'UFP Industries'], ['WCC', 'WESCO International'],
    ['WWD', 'Woodward'], ['XPO', 'XPO'], ['CNM', 'Core & Main'], ['WMS', 'Advanced Drainage Systems'], ['MIDD', 'Middleby'],
    ['FLS', 'Flowserve'], ['CR', 'Crane'], ['GXO', 'GXO Logistics'],
  ]),
  ...S('Technology', [
    ['ARW', 'Arrow Electronics'], ['AVT', 'Avnet'], ['CIEN', 'Ciena'], ['CVLT', 'Commvault'], ['DBX', 'Dropbox'],
    ['DT', 'Dynatrace'], ['FN', 'Fabrinet'], ['MANH', 'Manhattan Associates'], ['NOVT', 'Novanta'], ['PSTG', 'Pure Storage'],
    ['QLYS', 'Qualys'], ['SAIC', 'Science Applications International'], ['CACI', 'CACI International'], ['TDC', 'Teradata'], ['DOCU', 'DocuSign'],
    ['GWRE', 'Guidewire'], ['NTNX', 'Nutanix'], ['DLB', 'Dolby Laboratories'],
  ]),
  ...S('Semiconductors', [
    ['COHR', 'Coherent'], ['LSCC', 'Lattice Semiconductor'], ['MKSI', 'MKS'], ['ONTO', 'Onto Innovation'], ['OLED', 'Universal Display'],
    ['RMBS', 'Rambus'], ['SLAB', 'Silicon Labs'], ['AMKR', 'Amkor Technology'],
  ]),
  ...S('Consumer', [
    ['BURL', 'Burlington Stores'], ['CROX', 'Crocs'], ['FIVE', 'Five Below'], ['GAP', 'Gap'], ['LAD', 'Lithia Motors'],
    ['MUSA', 'Murphy USA'], ['PLNT', 'Planet Fitness'], ['TXRH', 'Texas Roadhouse'], ['WING', 'Wingstop'], ['YETI', 'YETI'],
    ['BYD', 'Boyd Gaming'], ['CHDN', 'Churchill Downs'], ['H', 'Hyatt Hotels'], ['HOG', 'Harley-Davidson'], ['KBH', 'KB Home'],
    ['MTH', 'Meritage Homes'], ['THO', 'Thor Industries'], ['ANF', 'Abercrombie & Fitch'], ['AEO', 'American Eagle Outfitters'], ['URBN', 'Urban Outfitters'],
    ['SCI', 'Service Corporation International'], ['CAVA', 'CAVA Group'], ['SHAK', 'Shake Shack'], ['VAC', 'Marriott Vacations'], ['PII', 'Polaris'],
  ]),
  ...S('Consumer Staples', [
    ['BJ', "BJ's Wholesale"], ['CELH', 'Celsius'], ['COKE', 'Coca-Cola Consolidated'], ['CASY', "Casey's General Stores"], ['ELF', 'e.l.f. Beauty'],
    ['FLO', 'Flowers Foods'], ['INGR', 'Ingredion'], ['LANC', 'Lancaster Colony'], ['PPC', "Pilgrim's Pride"], ['POST', 'Post Holdings'],
    ['SFM', 'Sprouts Farmers Market'], ['USFD', 'US Foods'], ['PFGC', 'Performance Food Group'],
  ]),
  ...S('Healthcare', [
    ['ACHC', 'Acadia Healthcare'], ['BRKR', 'Bruker'], ['CHE', 'Chemed'], ['EHC', 'Encompass Health'], ['ENSG', 'Ensign Group'],
    ['EXEL', 'Exelixis'], ['HALO', 'Halozyme'], ['JAZZ', 'Jazz Pharmaceuticals'], ['LNTH', 'Lantheus'], ['MASI', 'Masimo'],
    ['MEDP', 'Medpace'], ['NBIX', 'Neurocrine Biosciences'], ['OPCH', 'Option Care Health'], ['PEN', 'Penumbra'], ['PRGO', 'Perrigo'],
    ['THC', 'Tenet Healthcare'], ['UTHR', 'United Therapeutics'], ['BMRN', 'BioMarin'], ['GMED', 'Globus Medical'],
  ]),
  ...S('Financials', [
    ['AFG', 'American Financial Group'], ['ALLY', 'Ally Financial'], ['CBSH', 'Commerce Bancshares'], ['CFR', 'Cullen/Frost Bankers'], ['EWBC', 'East West Bancorp'],
    ['EVR', 'Evercore'], ['FAF', 'First American Financial'], ['FHN', 'First Horizon'], ['FNB', 'F.N.B.'], ['HLI', 'Houlihan Lokey'],
    ['JEF', 'Jefferies'], ['KNSL', 'Kinsale Capital'], ['ORI', 'Old Republic'], ['RGA', 'Reinsurance Group of America'], ['RLI', 'RLI'],
    ['SEIC', 'SEI Investments'], ['SF', 'Stifel Financial'], ['UMBF', 'UMB Financial'], ['WBS', 'Webster Financial'], ['WTFC', 'Wintrust Financial'],
    ['VOYA', 'Voya Financial'], ['EQH', 'Equitable Holdings'], ['PRI', 'Primerica'], ['MORN', 'Morningstar'], ['WEX', 'WEX'],
  ]),
  ...S('Energy', [
    ['AR', 'Antero Resources'], ['CHRD', 'Chord Energy'], ['CNX', 'CNX Resources'], ['DINO', 'HF Sinclair'], ['DTM', 'DT Midstream'],
    ['MTDR', 'Matador Resources'], ['MUR', 'Murphy Oil'], ['NOV', 'NOV'], ['OVV', 'Ovintiv'], ['PR', 'Permian Resources'],
    ['RRC', 'Range Resources'], ['WFRD', 'Weatherford International'],
  ]),
  ...S('Materials', [
    ['ATI', 'ATI'], ['AXTA', 'Axalta Coating Systems'], ['CMC', 'Commercial Metals'], ['CLF', 'Cleveland-Cliffs'], ['EXP', 'Eagle Materials'],
    ['RGLD', 'Royal Gold'], ['RPM', 'RPM International'], ['SON', 'Sonoco Products'], ['OLN', 'Olin'], ['AA', 'Alcoa'],
    ['CRS', 'Carpenter Technology'], ['KNF', 'Knife River'],
  ]),
  ...S('Utilities', [
    ['OGE', 'OGE Energy'], ['IDA', 'IDACORP'], ['NFG', 'National Fuel Gas'], ['POR', 'Portland General Electric'],
  ]),
  ...S('Communication', [
    ['NYT', 'New York Times'], ['NXST', 'Nexstar Media Group'],
  ]),
];

export function expansionEnabled(env: Record<string, string | undefined>): boolean {
  return (env.UNIVERSE_EXPANSION ?? 'on').toLowerCase() !== 'off';
}
