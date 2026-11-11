import React from 'react'
import { localizedLabel, tr } from '../i18n'
import { dateLocale } from '../scheduleUtils'
import { personNameLastFirst } from '../../shared/personNames'
import PhotoZoom from './ui/PhotoZoom'

// One read-only fact. Everything on this card comes from the record; nothing is
// editable here, so a missing value stays an em dash rather than an empty field.
const display = (value) => (value === null || value === undefined || value === '' ? '—' : value)

const shortDate = (value) => {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
}

const Info = ({ label, value, mono = false }) => (
  <div className="min-w-0">
    <dt className="text-[10px] leading-tight text-ink-3">{label}</dt>
    <dd
      className={`mt-0.5 truncate text-[11.5px] leading-snug text-ink-2 ${mono ? 'mono text-[10.5px]' : ''}`}
      title={typeof value === 'string' && value !== '—' ? value : undefined}
    >
      {display(value)}
    </dd>
  </div>
)

const InfoSection = ({ title, children }) => (
  <section className="mt-4 first:mt-0">
    <h3 className="kicker border-b border-line pb-1 text-[9px]">{title}</h3>
    <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
  </section>
)

// Full record for one student, presented as a read-only identity card. Shared by
// the pages that consult records (session records, records consultation) so the
// same file opens in a modal wherever a row points at it.
const StudentRecordCard = ({ card, lookups, photoClassName = 'h-32 w-32 text-[26px]' }) => {
  const student = card?.student
  const detail = card?.profile?.detail || {}
  const parents = card?.profile?.parents || {}
  const address = card?.profile?.personalAddress || null
  const birthPlace = card?.profile?.birthPlace || null
  const contacts = card?.profile?.emergencyContacts || []
  const combat = card?.profile?.combatOutfit || {}
  const parade = card?.profile?.paradeUniform || {}
  // A male student has no skirt: the two skirt sizes are not part of his card.
  const isMale = detail.PERSON_SEX === 'M'

  const firstName = detail.PERSON_FIRST_NAME || student?.PERSON_FIRST_NAME
  const lastName = detail.PERSON_LAST_NAME || student?.PERSON_LAST_NAME
  const fullName = personNameLastFirst(lastName, firstName)
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
  const personId = detail.PERSON_ID || student?.PERSON_ID
  const section = detail.SECTION_LABEL || student?.SECTION_LABEL
  const category = detail.TEACHING_CATEGORY_LABEL || student?.TEACHING_CATEGORY_LABEL
  const hobbies = (card?.profile?.hobbies || [])
    .map((hobby) => localizedLabel(hobby, 'HOBBY_NAME') || hobby.HOBBY_NAME_EN)
    .filter(Boolean)

  const nameOf = (rows, idKey, baseKey, id) => {
    const row = (rows || []).find((item) => String(item[idKey]) === String(id))
    if (!row) return null
    return localizedLabel(row, baseKey) || row[`${baseKey}_EN`] || null
  }

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-line pb-3">
        <div className={`serif grid ${photoClassName} shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line-strong text-ink-3`}>
          {card?.photo
            ? <PhotoZoom src={card.photo} alt={fullName || tr('Student')} />
            : initials || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="serif truncate text-[20px] leading-[25px] text-ink">{fullName || tr('Student')}</h2>
          <div className="mono mt-0.5 truncate text-[10px] text-ink-3">
            {personId ? `#${String(personId).padStart(4, '0')}` : '—'}
            {section ? ` · ${section}` : ''}
            {category ? ` · ${category}` : ''}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
            <span>{tr('Absences on record')} <span className="mono text-ink">{student?.ABSENCE_TOTAL ?? 0}</span></span>
            <span>{tr('Observations on record')} <span className="mono text-ink">{student?.OBSERVATION_TOTAL ?? 0}</span></span>
          </div>
        </div>
      </div>

      <InfoSection title={tr('Identity')}>
        <Info label={tr('Student number')} value={personId ? `#${String(personId).padStart(4, '0')}` : null} mono />
        <Info label={tr('Sex')} value={detail.PERSON_SEX === 'M' ? tr('Male') : detail.PERSON_SEX === 'F' ? tr('Female') : null} />
        <Info label={tr('Born')} value={detail.PERSON_BIRTHDATE ? shortDate(detail.PERSON_BIRTHDATE) : null} />
        <Info label={tr('Military Grade')} value={detail.PERSON_GRADE_LABEL} />
        <Info label={tr('Section')} value={section} />
        <Info label={tr('Teaching category')} value={category} />
        <Info label={tr('Foreign Student')} value={detail.STUDENT_IS_FOREIGN === true ? tr('Yes') : detail.STUDENT_IS_FOREIGN === false ? tr('No') : null} />
        <Info label={tr('Personal Phone')} value={detail.STUDENT_PERSONAL_PHONE} mono />
      </InfoSection>

      <InfoSection title={tr('Birth Place')}>
        <Info label={tr('Commune')} value={birthPlace?.COMMUNE_ID ? `#${birthPlace.COMMUNE_ID}` : null} mono />
        <Info label={tr('Daira')} value={birthPlace?.DAIRA_ID ? `#${birthPlace.DAIRA_ID}` : null} mono />
        <Info label={tr('Wilaya')} value={birthPlace?.WILAYA_ID ? `#${birthPlace.WILAYA_ID}` : null} mono />
      </InfoSection>

      <InfoSection title={tr('Health & Body')}>
        <Info label={tr('Blood Type')} value={detail.STUDENT_BLOOD_TYPE} />
        <Info label={tr('Health Status')} value={nameOf(lookups?.healthStatuses, 'HEALTH_STATUS_ID', 'HEALTH_STATUS', detail.STUDENT_HEALTH_STATUS_ID)} />
        <Info label={tr('Height (cm)')} value={detail.STUDENT_HEIGHT_CM} />
        <Info label={tr('Weight (kg)')} value={detail.STUDENT_WEIGHT_KG} />
        <Info label={tr('Military Necklace')} value={detail.STUDENT_MILITARY_NECKLACE} />
        <Info
          label={tr('Army / Force')}
          value={nameOf(lookups?.armies, 'ARMY_ID', 'ARMY_LABEL', detail.STUDENT_ARMY_ID)
            || nameOf(lookups?.armies, 'ARMY_ID', 'ARMY_NAME', detail.STUDENT_ARMY_ID)}
        />
      </InfoSection>

      <InfoSection title={tr('Documents & Schooling')}>
        <Info label={tr('Speciality')} value={nameOf(lookups?.specialities, 'STUDENT_SPECIALITY_ID', 'SPECIALITY_NAME', detail.STUDENT_SPECIALITY_ID)} />
        <Info label={tr('Academic Level')} value={nameOf(lookups?.academicLevels, 'ACADEMIC_LEVEL_ID', 'ACADEMIC_LEVEL', detail.STUDENT_ACADEMIC_LEVEL_ID)} />
        <Info label={tr('Educational Certificate')} value={nameOf(lookups?.educationalCertificates, 'EDUCATIONAL_CERTIFICATE_ID', 'EDUCATIONAL_CERTIFICATE_LABEL', detail.EDUCATIONAL_CERTIFICATE_ID)} />
        <Info label={tr('Academic Average')} value={detail.STUDENT_ACADEMIC_AVERAGE} />
        <Info label={tr('Baccalaureate Sub Number')} value={detail.STUDENT_BACCALAUREATE_SUB_NUMBER} mono />
        <Info label={tr('School Submission Date')} value={detail.STUDENT_SCHOOL_SUB_DATE ? shortDate(detail.STUDENT_SCHOOL_SUB_DATE) : null} />
        <Info label={tr('School Submission Card Number')} value={detail.STUDENT_SCHOOL_SUB_CARD_NUMBER} mono />
        <Info label={tr('Recruitment Source')} value={nameOf(lookups?.recruitmentSources, 'RECRUITMENT_SOURCE_ID', 'RECRUITMENT_SOURCE_LABEL', detail.STUDENT_RECRUITMENT_SOURCE_ID)} />
        <Info label={tr('Laptop Serial Number')} value={detail.STUDENT_LAPTOP_SERIAL_NUMBER} mono />
        <Info label={tr('National Identification Number')} value={detail.STUDENT_NATIONAL_IDENTIFICATION_NUMBER} mono />
        <Info label={tr('Birth Certificate Number')} value={detail.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER} mono />
        <Info label={tr('Postal Account Number')} value={detail.STUDENT_POSTAL_ACCOUNT_NUMBER} mono />
        <Info label={tr('Insurance Card Number')} value={detail.STUDENT_INSURANCE_CARD_NUMBER} mono />
        <Info label={tr('Military Card Number')} value={detail.STUDENT_MILITARY_CARD_NUMBER} mono />
        <Info label={tr('Military Helmet Number')} value={detail.STUDENT_MILITARY_HELMET_NUMBER} mono />
      </InfoSection>

      <InfoSection title={tr('Family')}>
        <Info label={tr('Father')} value={[parents.FATHER_FIRST_NAME_LA, parents.FATHER_LAST_NAME_LA].filter(Boolean).join(' ')} />
        <Info label={tr('Profession')} value={nameOf(lookups?.professions, 'PROFESSION_ID', 'PROFESSION_NAME', parents.FATHER_PROFESSION_ID)} />
        <Info label={tr('Mother')} value={[parents.MOTHER_FIRST_NAME_LA, parents.MOTHER_LAST_NAME_LA].filter(Boolean).join(' ')} />
        <Info label={tr('Profession')} value={nameOf(lookups?.professions, 'PROFESSION_ID', 'PROFESSION_NAME', parents.MOTHER_PROFESSION_ID)} />
        <Info label={tr('Siblings (total)')} value={detail.STUDENT_NUMBER_OF_SIBLINGS} />
        <Info label={tr('Sisters')} value={detail.STUDENT_NUMBER_OF_SISTERS} />
        <Info label={tr('Order Among Siblings')} value={detail.STUDENT_ORDER_AMONG_SIBLINGS} />
        <Info label={tr('Orphan Status')} value={detail.STUDENT_ORPHAN_STATUS} />
        <Info label={tr("Parents' Situation")} value={detail.STUDENT_PARENTS_SITUATION} />
        <Info label={tr('Hobbies')} value={hobbies.join(' · ')} />
      </InfoSection>

      <InfoSection title={tr('Personal Address')}>
        {address ? (
          <>
            <Info label={tr('Street (Latin)')} value={address.ADDRESS_STREET_LA} />
            <Info label={tr('Street (Arabic)')} value={address.ADDRESS_STREET_AR} />
            <Info label={tr('Commune')} value={address.COMMUNE_ID ? `#${address.COMMUNE_ID}` : null} mono />
            <Info label={tr('Daira')} value={address.DAIRA_ID ? `#${address.DAIRA_ID}` : null} mono />
            <Info label={tr('Wilaya')} value={address.WILAYA_ID ? `#${address.WILAYA_ID}` : null} mono />
          </>
        ) : (
          <div className="col-span-full text-[10.5px] text-ink-3">{tr('No personal address on file.')}</div>
        )}
      </InfoSection>

      <InfoSection title={tr('Uniforms')}>
        <Info label={tr('1st Outfit Number')} value={combat.FIRST_OUTFIT_NUMBER} mono />
        <Info label={tr('1st Outfit Size')} value={combat.FIRST_OUTFIT_SIZE} />
        <Info label={tr('2nd Outfit Number')} value={combat.SECOND_OUTFIT_NUMBER} mono />
        <Info label={tr('2nd Outfit Size')} value={combat.SECOND_OUTFIT_SIZE} />
        <Info label={tr('Combat Shoe Size')} value={combat.COMBAT_SHOE_SIZE} />
        <Info label={tr('Summer Jacket')} value={parade.SUMMER_JACKET_SIZE} />
        <Info label={tr('Winter Jacket')} value={parade.WINTER_JACKET_SIZE} />
        <Info label={tr('Summer Trousers')} value={parade.SUMMER_TROUSERS_SIZE} />
        <Info label={tr('Winter Trousers')} value={parade.WINTER_TROUSERS_SIZE} />
        <Info label={tr('Summer Shirt')} value={parade.SUMMER_SHIRT_SIZE} />
        <Info label={tr('Winter Shirt')} value={parade.WINTER_SHIRT_SIZE} />
        <Info label={tr('Summer Hat')} value={parade.SUMMER_HAT_SIZE} />
        <Info label={tr('Winter Hat')} value={parade.WINTER_HAT_SIZE} />
        {!isMale && <Info label={tr('Summer Skirt')} value={parade.SUMMER_SKIRT_SIZE} />}
        {!isMale && <Info label={tr('Winter Skirt')} value={parade.WINTER_SKIRT_SIZE} />}
      </InfoSection>

      <InfoSection title={tr('Emergency Contacts')}>
        {contacts.length === 0 ? (
          <div className="col-span-full text-[10.5px] text-ink-3">{tr('No emergency contacts recorded yet.')}</div>
        ) : contacts.map((contact) => {
          const name = [contact.CONTACT_FIRST_NAME_LA, contact.CONTACT_LAST_NAME_LA].filter(Boolean).join(' ')
          return (
            <Info
              key={contact.EMERGENCY_CONTACT_ID}
              label={contact.CONTACT_RELATION_NAME ? `${name || tr('Contact')} · ${contact.CONTACT_RELATION_NAME}` : name || tr('Contact')}
              value={contact.CONTACT_PHONE_NUMBER || contact.CONSULATE_NUMBER}
              mono={!!contact.CONTACT_PHONE_NUMBER}
            />
          )
        })}
      </InfoSection>
    </div>
  )
}

export default StudentRecordCard
