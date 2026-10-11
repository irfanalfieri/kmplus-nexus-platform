/**
 * Unified Enterprise Data Model (PRD §8): the standard business entities
 * KMPlus products consume, their canonical fields, and synonyms used to
 * auto-map source columns (MP-2) and dataset columns (Data API, API-3).
 * Client-safe.
 */

export interface DomainField {
  name: string
  type: 'text' | 'integer' | 'numeric' | 'boolean' | 'date' | 'timestamp' | 'json'
  label: string
  /** Lowercase alphanumeric spellings seen in HRIS/ERP systems (SAP, Talenta, local HRIS). */
  synonyms: string[]
  pii?: boolean
}

export interface DomainEntity {
  name: string
  label: string
  /** Natural key field. */
  key: string
  fields: DomainField[]
}

const f = (name: string, type: DomainField['type'], label: string, synonyms: string[], pii = false): DomainField => ({ name, type, label, synonyms, pii })

export const DOMAIN_ENTITIES: DomainEntity[] = [
  {
    name: 'employee',
    label: 'Employee',
    key: 'employee_code',
    fields: [
      f('employee_code', 'text', 'Employee code', ['pernr', 'empid', 'employeeid', 'employeeno', 'employeenumber', 'empno', 'nip', 'nik_karyawan', 'nikkaryawan', 'nopeg', 'nopegawai', 'staffid', 'code']),
      f('full_name', 'text', 'Full name', ['ename', 'name', 'nama', 'fullname', 'employeename', 'namakaryawan', 'namalengkap', 'cname'], true),
      f('email', 'text', 'Email', ['email', 'emailaddress', 'mail', 'workemail', 'emailkantor', 'usrid_long'], true),
      f('phone', 'text', 'Phone', ['phone', 'mobile', 'hp', 'nohp', 'telp', 'telepon', 'phonenumber', 'handphone', 'mobilephone'], true),
      f('national_id', 'text', 'National ID (NIK)', ['nik', 'ktp', 'noktp', 'nationalid', 'idnumber', 'identitynumber'], true),
      f('gender', 'text', 'Gender', ['gender', 'sex', 'jeniskelamin', 'gesch'], true),
      f('birth_date', 'date', 'Birth date', ['birthdate', 'dob', 'dateofbirth', 'tgllahir', 'tanggallahir', 'gbdat'], true),
      f('hire_date', 'date', 'Hire date', ['hiredate', 'joindate', 'joineddate', 'tglmasuk', 'tanggalmasuk', 'begda', 'startdate', 'joined']),
      f('termination_date', 'date', 'Termination date', ['terminationdate', 'enddate', 'tglkeluar', 'resigndate', 'endda', 'exitdate']),
      f('employment_status', 'text', 'Employment status', ['status', 'employmentstatus', 'stat', 'stat2', 'statuskaryawan', 'empstatus']),
      f('employment_type', 'text', 'Employment type', ['employmenttype', 'emptype', 'jeniskaryawan', 'persg', 'contracttype']),
      f('grade', 'text', 'Grade', ['grade', 'golongan', 'paygrade', 'trfgr', 'joblevel']),
      f('work_location', 'text', 'Work location', ['worklocation', 'location', 'lokasi', 'werks', 'site', 'office']),
      f('org_code', 'text', 'Organization code', ['orgcode', 'orgeh', 'org', 'departmentcode', 'deptcode', 'unitcode', 'kodeunit', 'orgunit']),
      f('position_code', 'text', 'Position code', ['positioncode', 'position', 'plans', 'kodejabatan', 'jobcode', 'positionid']),
      f('manager_code', 'text', 'Manager employee code', ['managercode', 'manager', 'managerid', 'supervisor', 'atasan', 'atasanid', 'reportsto', 'linemanager']),
      f('company_code', 'text', 'Company code', ['companycode', 'company', 'bukrs', 'perusahaan', 'entity']),
      f('department', 'text', 'Department name', ['department', 'dept', 'departemen', 'divisi', 'division']),
    ],
  },
  {
    name: 'organization',
    label: 'Organization',
    key: 'org_code',
    fields: [
      f('org_code', 'text', 'Organization code', ['orgcode', 'orgeh', 'code', 'unitcode', 'kodeunit', 'objid']),
      f('name', 'text', 'Name', ['name', 'orgname', 'nama', 'namaunit', 'stext']),
      f('type', 'text', 'Type', ['type', 'orgtype', 'level', 'tipe']),
      f('parent_org_code', 'text', 'Parent organization', ['parentorgcode', 'parent', 'parentcode', 'parentid', 'induk']),
      f('cost_center', 'text', 'Cost center', ['costcenter', 'kostl', 'cc']),
      f('head_employee_code', 'text', 'Head (employee code)', ['heademployeecode', 'head', 'headid', 'kepala']),
      f('company_code', 'text', 'Company code', ['companycode', 'company', 'bukrs']),
    ],
  },
  {
    name: 'position',
    label: 'Position',
    key: 'position_code',
    fields: [
      f('position_code', 'text', 'Position code', ['positioncode', 'plans', 'code', 'kodejabatan', 'objid']),
      f('title', 'text', 'Title', ['title', 'positionname', 'jabatan', 'namajabatan', 'stext']),
      f('job_family', 'text', 'Job family', ['jobfamily', 'family', 'stell']),
      f('job_level', 'text', 'Job level', ['joblevel', 'level', 'grade']),
      f('org_code', 'text', 'Organization code', ['orgcode', 'orgeh', 'org', 'unitcode']),
      f('is_vacant', 'boolean', 'Vacant', ['isvacant', 'vacant', 'kosong']),
      f('reports_to_position_code', 'text', 'Reports to (position)', ['reportstopositioncode', 'reportsto', 'parentposition']),
    ],
  },
  {
    name: 'company',
    label: 'Company',
    key: 'company_code',
    fields: [
      f('company_code', 'text', 'Company code', ['companycode', 'bukrs', 'code']),
      f('legal_name', 'text', 'Legal name', ['legalname', 'name', 'butxt', 'namaperusahaan']),
      f('country', 'text', 'Country', ['country', 'land1', 'negara']),
    ],
  },
  {
    name: 'competency',
    label: 'Competency',
    key: 'competency_code',
    fields: [
      f('competency_code', 'text', 'Competency code', ['competencycode', 'code', 'kodekompetensi']),
      f('name', 'text', 'Name', ['name', 'competency', 'kompetensi']),
      f('category', 'text', 'Category', ['category', 'kategori', 'type']),
      f('proficiency_scale', 'text', 'Proficiency scale', ['proficiencyscale', 'scale', 'skala']),
    ],
  },
  {
    name: 'training_history',
    label: 'Training history',
    key: 'id',
    fields: [
      f('id', 'text', 'Record id', ['id', 'recordid']),
      f('employee_code', 'text', 'Employee code', ['employeecode', 'pernr', 'empid', 'nip']),
      f('course_code', 'text', 'Course code', ['coursecode', 'course', 'kodepelatihan']),
      f('start_date', 'date', 'Start', ['startdate', 'begda', 'tglmulai']),
      f('end_date', 'date', 'End', ['enddate', 'endda', 'tglselesai']),
      f('hours', 'numeric', 'Hours', ['hours', 'jam', 'duration']),
      f('status', 'text', 'Status', ['status']),
      f('score', 'numeric', 'Score', ['score', 'nilai']),
    ],
  },
  {
    name: 'performance',
    label: 'Performance',
    key: 'id',
    fields: [
      f('id', 'text', 'Record id', ['id']),
      f('period', 'text', 'Period', ['period', 'periode', 'year']),
      f('employee_code', 'text', 'Employee code', ['employeecode', 'pernr', 'empid', 'nip']),
      f('kpi_code', 'text', 'KPI code', ['kpicode', 'kpi']),
      f('target', 'numeric', 'Target', ['target']),
      f('actual', 'numeric', 'Actual', ['actual', 'realisasi']),
      f('score', 'numeric', 'Score', ['score', 'nilai']),
      f('rating', 'text', 'Rating', ['rating', 'predikat']),
    ],
  },
]

export const DOMAIN_BY_NAME = new Map(DOMAIN_ENTITIES.map((e) => [e.name, e]))

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Best canonical field for a source column name, from any entity (or the given one). */
export function suggestCanonicalField(column: string, entity?: DomainEntity): string | null {
  const n = norm(column)
  const pools = entity ? [entity] : DOMAIN_ENTITIES
  for (const e of pools) for (const field of e.fields) if (norm(field.name) === n) return field.name
  for (const e of pools) for (const field of e.fields) if (field.synonyms.includes(n)) return field.name
  return null
}

/** Target name for auto-mapping a source column: canonical name when recognized, else a safe snake_case name. */
export function autoMapName(column: string): string {
  return suggestCanonicalField(column) ?? column.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').toLowerCase()
}
