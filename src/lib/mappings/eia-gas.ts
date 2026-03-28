// EIA gas price lookup tables:
// Maps CPI metro areas, county FIPS codes, and states to EIA duoarea codes
// used when fetching weekly retail gas price data from the EIA API.

// --- Tier 1: CPI metro area → EIA city duoarea ---

export const CPI_TO_EIA_CITY: Record<string, { duoarea: string; label: string }> = {
  'S49D': { duoarea: 'Y48SE', label: 'Seattle area avg' },
  'S49A': { duoarea: 'Y05LA', label: 'Los Angeles area avg' },
  'S49B': { duoarea: 'Y05SF', label: 'San Francisco area avg' },
  'S12A': { duoarea: 'Y35NY', label: 'New York City area avg' },
  'S11A': { duoarea: 'YBOS', label: 'Boston area avg' },
  'S23A': { duoarea: 'YORD', label: 'Chicago area avg' },
  'S48B': { duoarea: 'YDEN', label: 'Denver area avg' },
  'S37B': { duoarea: 'Y44HO', label: 'Houston area avg' },
  'S35B': { duoarea: 'YMIA', label: 'Miami area avg' },
}

export const COUNTY_EIA_CITY_OVERRIDES: Record<string, { duoarea: string; label: string }> = {
  '39035': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Cuyahoga County
  '39093': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lorain County
  '39085': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Lake County
  '39055': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Geauga County
  '39103': { duoarea: 'YCLE', label: 'Cleveland area avg' },  // Medina County
  // SW Washington counties in the Portland-Vancouver-Hillsboro OR-WA MSA
  // EIA has no Portland city-level gas series — use WA state avg (not Seattle)
  '53011': { duoarea: 'SWA', label: 'Washington state avg' },  // Clark County (Vancouver)
  '53015': { duoarea: 'SWA', label: 'Washington state avg' },  // Cowlitz County (Longview)
  '53059': { duoarea: 'SWA', label: 'Washington state avg' },  // Skamania County
  // Jacksonville FL — FL state avg, not Miami city
  '12031': { duoarea: 'SFL', label: 'Florida state avg' },  // Duval County (Jacksonville)
  // Orlando FL — FL state avg, not Miami city
  '12095': { duoarea: 'SFL', label: 'Florida state avg' },  // Orange County (Orlando)
  // Upstate NY — NY state avg, not NYC city
  '36029': { duoarea: 'SNY', label: 'New York state avg' },  // Erie County (Buffalo)
  '36055': { duoarea: 'SNY', label: 'New York state avg' },  // Monroe County (Rochester)
  '36067': { duoarea: 'SNY', label: 'New York state avg' },  // Onondaga County (Syracuse)
  // Louisiana parishes — Gulf Coast PAD 3, not Houston city
  '22071': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Orleans Parish (New Orleans)
  '22033': { duoarea: 'R30', label: 'Gulf Coast avg' },  // East Baton Rouge Parish
  '22051': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Jefferson Parish (Metairie)
  '22017': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Caddo Parish (Shreveport)
  '22055': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Lafayette Parish
  '22019': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Calcasieu Parish (Lake Charles)
  '22079': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Rapides Parish (Alexandria)
  '22073': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Ouachita Parish (Monroe)
  '22109': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Terrebonne Parish (Houma)
  '22015': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Bossier Parish
  '22063': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Livingston Parish
  '22103': { duoarea: 'R30', label: 'Gulf Coast avg' },  // St. Tammany Parish
  // CT → New England avg (not New York City area avg via CPI chain)
  '09120': { duoarea: 'R1X', label: 'New England avg' },  // Greater Bridgeport Planning Region
  '09130': { duoarea: 'R1X', label: 'New England avg' },  // Lower Connecticut River Valley Planning Region
  '09140': { duoarea: 'R1X', label: 'New England avg' },  // Naugatuck Valley Planning Region
  '09160': { duoarea: 'R1X', label: 'New England avg' },  // Northwest Hills Planning Region
  '09170': { duoarea: 'R1X', label: 'New England avg' },  // South Central Connecticut Planning Region
  '09190': { duoarea: 'R1X', label: 'New England avg' },  // Western Connecticut Planning Region
  // ID → Rocky Mountain avg (not Seattle area avg via CPI chain)
  '16001': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Ada County
  '16003': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Adams County
  '16009': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Benewah County
  '16013': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Blaine County
  '16015': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Boise County
  '16017': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Bonner County
  '16021': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Boundary County
  '16025': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Camas County
  '16027': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Canyon County
  '16035': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Clearwater County
  '16037': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Custer County
  '16039': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Elmore County
  '16045': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Gem County
  '16047': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Gooding County
  '16049': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Idaho County
  '16053': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Jerome County
  '16055': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Kootenai County
  '16057': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Latah County
  '16059': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lemhi County
  '16061': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lewis County
  '16063': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lincoln County
  '16069': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Nez Perce County
  '16073': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Owyhee County
  '16075': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Payette County
  '16079': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Shoshone County
  '16083': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Twin Falls County
  '16085': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Valley County
  '16087': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Washington County
  // KS → Midwest avg (not Denver area avg via CPI chain)
  '20009': { duoarea: 'R20', label: 'Midwest avg' },  // Barton County
  '20023': { duoarea: 'R20', label: 'Midwest avg' },  // Cheyenne County
  '20025': { duoarea: 'R20', label: 'Midwest avg' },  // Clark County
  '20029': { duoarea: 'R20', label: 'Midwest avg' },  // Cloud County
  '20039': { duoarea: 'R20', label: 'Midwest avg' },  // Decatur County
  '20047': { duoarea: 'R20', label: 'Midwest avg' },  // Edwards County
  '20051': { duoarea: 'R20', label: 'Midwest avg' },  // Ellis County
  '20053': { duoarea: 'R20', label: 'Midwest avg' },  // Ellsworth County
  '20055': { duoarea: 'R20', label: 'Midwest avg' },  // Finney County
  '20057': { duoarea: 'R20', label: 'Midwest avg' },  // Ford County
  '20063': { duoarea: 'R20', label: 'Midwest avg' },  // Gove County
  '20065': { duoarea: 'R20', label: 'Midwest avg' },  // Graham County
  '20067': { duoarea: 'R20', label: 'Midwest avg' },  // Grant County
  '20069': { duoarea: 'R20', label: 'Midwest avg' },  // Gray County
  '20071': { duoarea: 'R20', label: 'Midwest avg' },  // Greeley County
  '20075': { duoarea: 'R20', label: 'Midwest avg' },  // Hamilton County
  '20081': { duoarea: 'R20', label: 'Midwest avg' },  // Haskell County
  '20083': { duoarea: 'R20', label: 'Midwest avg' },  // Hodgeman County
  '20089': { duoarea: 'R20', label: 'Midwest avg' },  // Jewell County
  '20093': { duoarea: 'R20', label: 'Midwest avg' },  // Kearny County
  '20097': { duoarea: 'R20', label: 'Midwest avg' },  // Kiowa County
  '20101': { duoarea: 'R20', label: 'Midwest avg' },  // Lane County
  '20105': { duoarea: 'R20', label: 'Midwest avg' },  // Lincoln County
  '20109': { duoarea: 'R20', label: 'Midwest avg' },  // Logan County
  '20119': { duoarea: 'R20', label: 'Midwest avg' },  // Meade County
  '20123': { duoarea: 'R20', label: 'Midwest avg' },  // Mitchell County
  '20129': { duoarea: 'R20', label: 'Midwest avg' },  // Morton County
  '20135': { duoarea: 'R20', label: 'Midwest avg' },  // Ness County
  '20137': { duoarea: 'R20', label: 'Midwest avg' },  // Norton County
  '20141': { duoarea: 'R20', label: 'Midwest avg' },  // Osborne County
  '20143': { duoarea: 'R20', label: 'Midwest avg' },  // Ottawa County
  '20145': { duoarea: 'R20', label: 'Midwest avg' },  // Pawnee County
  '20147': { duoarea: 'R20', label: 'Midwest avg' },  // Phillips County
  '20153': { duoarea: 'R20', label: 'Midwest avg' },  // Rawlins County
  '20157': { duoarea: 'R20', label: 'Midwest avg' },  // Republic County
  '20159': { duoarea: 'R20', label: 'Midwest avg' },  // Rice County
  '20163': { duoarea: 'R20', label: 'Midwest avg' },  // Rooks County
  '20165': { duoarea: 'R20', label: 'Midwest avg' },  // Rush County
  '20167': { duoarea: 'R20', label: 'Midwest avg' },  // Russell County
  '20169': { duoarea: 'R20', label: 'Midwest avg' },  // Saline County
  '20171': { duoarea: 'R20', label: 'Midwest avg' },  // Scott County
  '20175': { duoarea: 'R20', label: 'Midwest avg' },  // Seward County
  '20179': { duoarea: 'R20', label: 'Midwest avg' },  // Sheridan County
  '20181': { duoarea: 'R20', label: 'Midwest avg' },  // Sherman County
  '20183': { duoarea: 'R20', label: 'Midwest avg' },  // Smith County
  '20185': { duoarea: 'R20', label: 'Midwest avg' },  // Stafford County
  '20187': { duoarea: 'R20', label: 'Midwest avg' },  // Stanton County
  '20189': { duoarea: 'R20', label: 'Midwest avg' },  // Stevens County
  '20193': { duoarea: 'R20', label: 'Midwest avg' },  // Thomas County
  '20195': { duoarea: 'R20', label: 'Midwest avg' },  // Trego County
  '20199': { duoarea: 'R20', label: 'Midwest avg' },  // Wallace County
  '20203': { duoarea: 'R20', label: 'Midwest avg' },  // Wichita County
  // MT → Rocky Mountain avg (not Seattle area avg via CPI chain)
  '30001': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Beaverhead County
  '30005': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Blaine County
  '30007': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Broadwater County
  '30013': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Cascade County
  '30015': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Chouteau County
  '30023': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Deer Lodge County
  '30029': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Flathead County
  '30035': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Glacier County
  '30039': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Granite County
  '30041': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Hill County
  '30043': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Jefferson County
  '30045': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Judith Basin County
  '30047': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lake County
  '30049': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lewis and Clark County
  '30051': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Liberty County
  '30053': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Lincoln County
  '30057': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Madison County
  '30059': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Meagher County
  '30061': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Mineral County
  '30063': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Missoula County
  '30073': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Pondera County
  '30077': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Powell County
  '30081': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Ravalli County
  '30089': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Sanders County
  '30093': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Silver Bow County
  '30099': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Teton County
  '30101': { duoarea: 'R40', label: 'Rocky Mountain avg' },  // Toole County
  // ND → Midwest avg (not Denver area avg via CPI chain)
  '38011': { duoarea: 'R20', label: 'Midwest avg' },  // Bowman County
  '38033': { duoarea: 'R20', label: 'Midwest avg' },  // Golden Valley County
  '38087': { duoarea: 'R20', label: 'Midwest avg' },  // Slope County
  // NE → Midwest avg (not Denver area avg via CPI chain)
  '31001': { duoarea: 'R20', label: 'Midwest avg' },  // Adams County
  '31005': { duoarea: 'R20', label: 'Midwest avg' },  // Arthur County
  '31007': { duoarea: 'R20', label: 'Midwest avg' },  // Banner County
  '31009': { duoarea: 'R20', label: 'Midwest avg' },  // Blaine County
  '31013': { duoarea: 'R20', label: 'Midwest avg' },  // Box Butte County
  '31017': { duoarea: 'R20', label: 'Midwest avg' },  // Brown County
  '31019': { duoarea: 'R20', label: 'Midwest avg' },  // Buffalo County
  '31029': { duoarea: 'R20', label: 'Midwest avg' },  // Chase County
  '31031': { duoarea: 'R20', label: 'Midwest avg' },  // Cherry County
  '31033': { duoarea: 'R20', label: 'Midwest avg' },  // Cheyenne County
  '31035': { duoarea: 'R20', label: 'Midwest avg' },  // Clay County
  '31041': { duoarea: 'R20', label: 'Midwest avg' },  // Custer County
  '31045': { duoarea: 'R20', label: 'Midwest avg' },  // Dawes County
  '31047': { duoarea: 'R20', label: 'Midwest avg' },  // Dawson County
  '31049': { duoarea: 'R20', label: 'Midwest avg' },  // Deuel County
  '31057': { duoarea: 'R20', label: 'Midwest avg' },  // Dundy County
  '31061': { duoarea: 'R20', label: 'Midwest avg' },  // Franklin County
  '31063': { duoarea: 'R20', label: 'Midwest avg' },  // Frontier County
  '31065': { duoarea: 'R20', label: 'Midwest avg' },  // Furnas County
  '31069': { duoarea: 'R20', label: 'Midwest avg' },  // Garden County
  '31071': { duoarea: 'R20', label: 'Midwest avg' },  // Garfield County
  '31073': { duoarea: 'R20', label: 'Midwest avg' },  // Gosper County
  '31075': { duoarea: 'R20', label: 'Midwest avg' },  // Grant County
  '31079': { duoarea: 'R20', label: 'Midwest avg' },  // Hall County
  '31083': { duoarea: 'R20', label: 'Midwest avg' },  // Harlan County
  '31085': { duoarea: 'R20', label: 'Midwest avg' },  // Hayes County
  '31087': { duoarea: 'R20', label: 'Midwest avg' },  // Hitchcock County
  '31091': { duoarea: 'R20', label: 'Midwest avg' },  // Hooker County
  '31093': { duoarea: 'R20', label: 'Midwest avg' },  // Howard County
  '31099': { duoarea: 'R20', label: 'Midwest avg' },  // Kearney County
  '31101': { duoarea: 'R20', label: 'Midwest avg' },  // Keith County
  '31103': { duoarea: 'R20', label: 'Midwest avg' },  // Keya Paha County
  '31105': { duoarea: 'R20', label: 'Midwest avg' },  // Kimball County
  '31111': { duoarea: 'R20', label: 'Midwest avg' },  // Lincoln County
  '31113': { duoarea: 'R20', label: 'Midwest avg' },  // Logan County
  '31115': { duoarea: 'R20', label: 'Midwest avg' },  // Loup County
  '31117': { duoarea: 'R20', label: 'Midwest avg' },  // McPherson County
  '31123': { duoarea: 'R20', label: 'Midwest avg' },  // Morrill County
  '31129': { duoarea: 'R20', label: 'Midwest avg' },  // Nuckolls County
  '31135': { duoarea: 'R20', label: 'Midwest avg' },  // Perkins County
  '31137': { duoarea: 'R20', label: 'Midwest avg' },  // Phelps County
  '31145': { duoarea: 'R20', label: 'Midwest avg' },  // Red Willow County
  '31149': { duoarea: 'R20', label: 'Midwest avg' },  // Rock County
  '31157': { duoarea: 'R20', label: 'Midwest avg' },  // Scotts Bluff County
  '31161': { duoarea: 'R20', label: 'Midwest avg' },  // Sheridan County
  '31163': { duoarea: 'R20', label: 'Midwest avg' },  // Sherman County
  '31165': { duoarea: 'R20', label: 'Midwest avg' },  // Sioux County
  '31169': { duoarea: 'R20', label: 'Midwest avg' },  // Thayer County
  '31171': { duoarea: 'R20', label: 'Midwest avg' },  // Thomas County
  '31175': { duoarea: 'R20', label: 'Midwest avg' },  // Valley County
  '31181': { duoarea: 'R20', label: 'Midwest avg' },  // Webster County
  // NM → Gulf Coast avg (not Denver area avg via CPI chain)
  '35007': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Colfax County
  '35009': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Curry County
  '35011': { duoarea: 'R30', label: 'Gulf Coast avg' },  // De Baca County
  '35019': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Guadalupe County
  '35021': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Harding County
  '35028': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Los Alamos County
  '35033': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Mora County
  '35037': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Quay County
  '35039': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Rio Arriba County
  '35043': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Sandoval County
  '35045': { duoarea: 'R30', label: 'Gulf Coast avg' },  // San Juan County
  '35047': { duoarea: 'R30', label: 'Gulf Coast avg' },  // San Miguel County
  '35049': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Santa Fe County
  '35055': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Taos County
  '35057': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Torrance County
  '35059': { duoarea: 'R30', label: 'Gulf Coast avg' },  // Union County
  // NY → New York state avg (not Boston area avg via CPI chain)
  '36019': { duoarea: 'SNY', label: 'New York state avg' },  // Clinton County
  '36031': { duoarea: 'SNY', label: 'New York state avg' },  // Essex County
  '36033': { duoarea: 'SNY', label: 'New York state avg' },  // Franklin County
  '36041': { duoarea: 'SNY', label: 'New York state avg' },  // Hamilton County
  '36083': { duoarea: 'SNY', label: 'New York state avg' },  // Rensselaer County
  '36089': { duoarea: 'SNY', label: 'New York state avg' },  // St. Lawrence County
  '36091': { duoarea: 'SNY', label: 'New York state avg' },  // Saratoga County
  '36113': { duoarea: 'SNY', label: 'New York state avg' },  // Warren County
  '36115': { duoarea: 'SNY', label: 'New York state avg' },  // Washington County
  // OK → Midwest avg (not Denver area avg via CPI chain)
  '40007': { duoarea: 'R20', label: 'Midwest avg' },  // Beaver County
  '40025': { duoarea: 'R20', label: 'Midwest avg' },  // Cimarron County
  '40139': { duoarea: 'R20', label: 'Midwest avg' },  // Texas County
  // SD → Midwest avg (not Denver area avg via CPI chain)
  '46007': { duoarea: 'R20', label: 'Midwest avg' },  // Bennett County
  '46019': { duoarea: 'R20', label: 'Midwest avg' },  // Butte County
  '46033': { duoarea: 'R20', label: 'Midwest avg' },  // Custer County
  '46047': { duoarea: 'R20', label: 'Midwest avg' },  // Fall River County
  '46055': { duoarea: 'R20', label: 'Midwest avg' },  // Haakon County
  '46063': { duoarea: 'R20', label: 'Midwest avg' },  // Harding County
  '46071': { duoarea: 'R20', label: 'Midwest avg' },  // Jackson County
  '46075': { duoarea: 'R20', label: 'Midwest avg' },  // Jones County
  '46081': { duoarea: 'R20', label: 'Midwest avg' },  // Lawrence County
  '46093': { duoarea: 'R20', label: 'Midwest avg' },  // Meade County
  '46095': { duoarea: 'R20', label: 'Midwest avg' },  // Mellette County
  '46102': { duoarea: 'R20', label: 'Midwest avg' },  // Oglala Lakota County
  '46103': { duoarea: 'R20', label: 'Midwest avg' },  // Pennington County
  '46105': { duoarea: 'R20', label: 'Midwest avg' },  // Perkins County
  '46121': { duoarea: 'R20', label: 'Midwest avg' },  // Todd County
  '46137': { duoarea: 'R20', label: 'Midwest avg' },  // Ziebach County
  // TX → Texas state avg (not Denver area avg via CPI chain)
  '48111': { duoarea: 'STX', label: 'Texas state avg' },  // Dallam County
  '48117': { duoarea: 'STX', label: 'Texas state avg' },  // Deaf Smith County
  '48195': { duoarea: 'STX', label: 'Texas state avg' },  // Hansford County
  '48205': { duoarea: 'STX', label: 'Texas state avg' },  // Hartley County
  '48233': { duoarea: 'STX', label: 'Texas state avg' },  // Hutchinson County
  '48341': { duoarea: 'STX', label: 'Texas state avg' },  // Moore County
  '48357': { duoarea: 'STX', label: 'Texas state avg' },  // Ochiltree County
  '48359': { duoarea: 'STX', label: 'Texas state avg' },  // Oldham County
  '48421': { duoarea: 'STX', label: 'Texas state avg' },  // Sherman County
}

// --- Tier 2: State-level EIA data (8 states) ---

export const STATE_LEVEL_CODES: Record<string, { duoarea: string; label: string }> = {
  WA: { duoarea: 'SWA', label: 'Washington state avg' },
  CA: { duoarea: 'SCA', label: 'California state avg' },
  CO: { duoarea: 'SCO', label: 'Colorado state avg' },
  FL: { duoarea: 'SFL', label: 'Florida state avg' },
  MA: { duoarea: 'SMA', label: 'Massachusetts state avg' },
  MN: { duoarea: 'SMN', label: 'Minnesota state avg' },
  NY: { duoarea: 'SNY', label: 'New York state avg' },
  OH: { duoarea: 'SOH', label: 'Ohio state avg' },
  TX: { duoarea: 'STX', label: 'Texas state avg' },
}

// --- Tier 3: PAD District (fallback) ---

export const STATE_TO_PAD: Record<string, number | string> = {
  // PAD 1A — New England
  ME: '1A', NH: '1A', VT: '1A', MA: '1A', RI: '1A', CT: '1A',
  // PAD 1B — Central Atlantic
  NY: '1B', NJ: '1B', PA: '1B', DE: '1B', MD: '1B', DC: '1B',
  // PAD 1C — Lower Atlantic
  VA: '1C', WV: '1C', NC: '1C', SC: '1C', GA: '1C', FL: '1C',
  // PAD 2 — Midwest
  OH: 2, MI: 2, IN: 2, IL: 2, WI: 2, MN: 2, IA: 2, MO: 2, ND: 2,
  SD: 2, NE: 2, KS: 2, KY: 2, TN: 2, OK: 2,
  // PAD 3 — Gulf Coast
  TX: 3, LA: 3, MS: 3, AL: 3, AR: 3, NM: 3,
  // PAD 4 — Rocky Mountain
  MT: 4, ID: 4, WY: 4, CO: 4, UT: 4,
  // PAD 5 — West Coast
  WA: 5, OR: 5, CA: 5, NV: 5, AZ: 5, AK: 5, HI: 5,
}

export const PAD_NAMES: Record<string | number, string> = {
  '1A': 'New England',
  '1B': 'Central Atlantic',
  '1C': 'Lower Atlantic',
  2: 'Midwest',
  3: 'Gulf Coast',
  4: 'Rocky Mountain',
  5: 'West Coast',
}

export const PAD_DUOAREA: Record<string | number, string> = {
  '1A': 'R1X',
  '1B': 'R1Y',
  '1C': 'R1Z',
  2: 'R20',
  3: 'R30',
  4: 'R40',
  5: 'R50',
}
