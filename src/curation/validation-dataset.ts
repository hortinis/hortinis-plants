import {
  isValidGerminationProfile,
  isValidTemperatureProfile,
} from "../domain/temperature-profile.js";

export interface DatasetValidationIssue {
  readonly code:
    | "DUPLICATE_ID"
    | "MISSING_REFERENCE"
    | "INVALID_SCOPE"
    | "INVALID_SUPERSESSION"
    | "INVALID_TAXONOMIC_NAME"
    | "DUPLICATE_ACCEPTED_TAXONOMIC_NAME"
    | "DUPLICATE_PREFERRED_NAME"
    | "INVALID_REVIEW_REFERENCE"
    | "INVALID_CALENDAR_VALUE"
    | "INVALID_VALUE_RANGE"
    | "INVALID_TEMPERATURE_PROFILE"
    | "INVALID_GERMINATION_PROFILE";
  readonly recordId: string;
  readonly message: string;
}

export type DatasetRecord = Readonly<Record<string, unknown>>;

export interface ValidationDataset {
  readonly sourceManifestId?: string;
  /**
   * Pinned releases permitted in C4 authoring decisions. This is distinct from
   * `sourceManifestId`, which retains the V1 single-source evidence check.
   */
  readonly sourceManifestIds?: readonly string[];
  readonly taxa: readonly DatasetRecord[];
  readonly taxonomicNames?: readonly DatasetRecord[];
  readonly plantConcepts: readonly DatasetRecord[];
  readonly cultivarGroups?: readonly DatasetRecord[];
  readonly cultivars: readonly DatasetRecord[];
  readonly localizedNames?: readonly DatasetRecord[];
  readonly geographicContexts?: readonly DatasetRecord[];
  readonly contexts: readonly DatasetRecord[];
  readonly facts?: readonly DatasetRecord[];
  readonly rules: readonly DatasetRecord[];
  readonly relationships?: readonly DatasetRecord[];
  readonly assertions: readonly DatasetRecord[];
  readonly evidence: readonly DatasetRecord[];
  readonly sources?: readonly DatasetRecord[];
  readonly licences?: readonly DatasetRecord[];
  readonly reviews: readonly DatasetRecord[];
  readonly curationIssues?: readonly DatasetRecord[];
  readonly externalTaxonomyCrosswalks?: readonly DatasetRecord[];
  readonly sourceNameDecisions?: readonly DatasetRecord[];
  readonly sourceSubjectMappings?: readonly DatasetRecord[];
  readonly sourceGeographyDecisions?: readonly DatasetRecord[];
  readonly sourceAssertionDecisions?: readonly DatasetRecord[];
}

type Collection = readonly DatasetRecord[];

export function validateValidationDataset(
  dataset: ValidationDataset,
): DatasetValidationIssue[] {
  const issues: DatasetValidationIssue[] = [];
  const collections: Readonly<Record<string, Collection>> = {
    taxa: dataset.taxa,
    taxonomicNames: dataset.taxonomicNames ?? [],
    plantConcepts: dataset.plantConcepts,
    cultivarGroups: dataset.cultivarGroups ?? [],
    cultivars: dataset.cultivars,
    localizedNames: dataset.localizedNames ?? [],
    geographicContexts: dataset.geographicContexts ?? [],
    contexts: dataset.contexts,
    facts: dataset.facts ?? [],
    rules: dataset.rules,
    relationships: dataset.relationships ?? [],
    assertions: dataset.assertions,
    evidence: dataset.evidence,
    sources: dataset.sources ?? [],
    licences: dataset.licences ?? [],
    reviews: dataset.reviews,
    curationIssues: dataset.curationIssues ?? [],
    externalTaxonomyCrosswalks: dataset.externalTaxonomyCrosswalks ?? [],
    sourceNameDecisions: dataset.sourceNameDecisions ?? [],
    sourceSubjectMappings: dataset.sourceSubjectMappings ?? [],
    sourceGeographyDecisions: dataset.sourceGeographyDecisions ?? [],
    sourceAssertionDecisions: dataset.sourceAssertionDecisions ?? [],
  };
  const recordsByKind = new Map<string, Map<string, DatasetRecord>>();
  const globalIds = new Map<string, string>();

  for (const [kind, records] of Object.entries(collections)) {
    const recordsById = new Map<string, DatasetRecord>();
    recordsByKind.set(kind, recordsById);
    for (const record of records) {
      const id = stringField(record, "id");
      if (id === undefined) continue;
      const previousKind = globalIds.get(id);
      if (previousKind !== undefined) {
        issues.push({
          code: "DUPLICATE_ID",
          recordId: id,
          message: `Identifier ${id} is reused by ${previousKind} and ${kind}`,
        });
      } else {
        globalIds.set(id, kind);
      }
      recordsById.set(id, record);
    }
  }

  const get = (kind: string, id: string): DatasetRecord | undefined =>
    recordsByKind.get(kind)?.get(id);
  const exists = (kind: string, id: string): boolean =>
    get(kind, id) !== undefined;
  const missing = (recordId: string, kind: string, id: string): void => {
    if (!exists(kind, id)) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId,
        message: `References missing ${kind} record ${id}`,
      });
    }
  };

  for (const record of dataset.taxa) {
    const id = recordId(record);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkReplacement(record, "replacementTaxonId", "taxa", missing, id);
  }
  for (const record of dataset.taxonomicNames ?? []) {
    const id = recordId(record);
    const taxonId = stringField(record, "taxonId");
    if (taxonId !== undefined) missing(id, "taxa", taxonId);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "replacementTaxonomicNameId",
      "taxonomicNames",
      missing,
      id,
    );
    checkAllowedSourceManifest(record, id);

    const acceptedNameId = stringField(record, "acceptedTaxonomicNameId");
    if (acceptedNameId !== undefined) {
      const acceptedName = get("taxonomicNames", acceptedNameId);
      if (acceptedName === undefined) {
        missing(id, "taxonomicNames", acceptedNameId);
      } else if (
        stringField(acceptedName, "nameStatus") !== "accepted" ||
        stringField(acceptedName, "status") !== "active" ||
        stringField(acceptedName, "taxonId") !== taxonId
      ) {
        issues.push({
          code: "INVALID_TAXONOMIC_NAME",
          recordId: id,
          message: `Synonym ${id} must reference an active accepted name on the same taxon`,
        });
      }
    }
  }
  if (dataset.taxonomicNames !== undefined) {
    checkAcceptedTaxonomicNames(dataset, issues);
  }
  for (const record of dataset.plantConcepts) {
    const id = recordId(record);
    const taxonId = stringField(record, "taxonId");
    if (taxonId !== undefined) missing(id, "taxa", taxonId);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkReplacement(
      record,
      "replacementPlantConceptId",
      "plantConcepts",
      missing,
      id,
    );
  }
  for (const record of dataset.cultivarGroups ?? []) {
    const id = recordId(record);
    const parentId = stringField(record, "plantConceptId");
    if (parentId !== undefined) missing(id, "plantConcepts", parentId);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkReplacement(
      record,
      "replacementCultivarGroupId",
      "cultivarGroups",
      missing,
      id,
    );
  }
  for (const record of dataset.cultivars) {
    const id = recordId(record);
    const parentId = stringField(record, "plantConceptId");
    if (parentId !== undefined) missing(id, "plantConcepts", parentId);
    for (const groupId of stringArray(record.cultivarGroupIds)) {
      const group = get("cultivarGroups", groupId);
      if (group === undefined) {
        missing(id, "cultivarGroups", groupId);
      } else if (stringField(group, "plantConceptId") !== parentId) {
        issues.push({
          code: "INVALID_SCOPE",
          recordId: id,
          message: `Cultivar group ${groupId} does not belong to parent plant concept ${parentId ?? "<missing>"}`,
        });
      }
    }
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkReplacement(record, "replacementCultivarId", "cultivars", missing, id);
  }

  for (const record of dataset.localizedNames ?? []) {
    const id = recordId(record);
    checkSubject(record.subject, id, true, missing, issues);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
  }
  checkPreferredNames(dataset.localizedNames ?? [], issues);

  for (const record of dataset.geographicContexts ?? []) {
    const id = recordId(record);
    checkIdReferences(
      record,
      "parentGeographicContextIds",
      "geographicContexts",
      missing,
      id,
    );
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
    checkParentCycles(
      record,
      "parentGeographicContextIds",
      "geographicContexts",
      get,
      issues,
    );
  }
  for (const record of dataset.contexts) {
    const id = recordId(record);
    const geographicScope = asRecord(record.geographicScope);
    if (geographicScope?.type === "specified") {
      checkIdReferences(
        geographicScope,
        "geographicContextIds",
        "geographicContexts",
        missing,
        id,
      );
    }
  }

  for (const record of dataset.evidence) {
    const id = recordId(record);
    const sourceId = stringField(record, "sourceId");
    const licenceId = stringField(asRecord(record.rights), "licenceId");
    const rightsReviewId = stringField(asRecord(record.rights), "reviewId");
    if (sourceId !== undefined && (dataset.sources?.length ?? 0) > 0) {
      missing(id, "sources", sourceId);
    }
    if (licenceId !== undefined && (dataset.licences?.length ?? 0) > 0) {
      missing(id, "licences", licenceId);
    }
    if (
      dataset.sourceManifestId !== undefined &&
      stringField(record, "sourceManifestId") !== dataset.sourceManifestId
    ) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId: id,
        message: `Evidence references source manifest ${stringField(record, "sourceManifestId") ?? "<missing>"}, expected ${dataset.sourceManifestId}`,
      });
    }
    if (rightsReviewId !== undefined) {
      checkReview(rightsReviewId, "rights", id, get, issues);
    }
  }

  for (const record of dataset.facts ?? []) {
    validateScopedRecord(
      record,
      "facts",
      "supersedesFactIds",
      "facts",
      checkFactValue,
    );
  }
  for (const record of dataset.rules) {
    validateScopedRecord(
      record,
      "rules",
      "supersedesRuleIds",
      "rules",
      checkRuleValue,
    );
  }
  for (const record of dataset.relationships ?? []) {
    validateScopedRecord(
      record,
      "relationships",
      "supersedesRelationshipIds",
      "relationships",
      () => undefined,
    );
    checkSubject(record.target, recordId(record), true, missing, issues);
    const subject = asRecord(record.subject);
    const target = asRecord(record.target);
    if (
      subject !== undefined &&
      target !== undefined &&
      subject.type === target.type &&
      subject.id === target.id
    ) {
      issues.push({
        code: "INVALID_SCOPE",
        recordId: recordId(record),
        message: "Relationship subject and target must differ",
      });
    }
  }
  for (const record of dataset.assertions) {
    const id = recordId(record);
    checkSubject(record.subject, id, false, missing, issues);
    checkContextAndEvidence(record, id, missing);
    checkContentReview(record, id, get, issues);
    checkFactValue(record, issues);
  }
  for (const record of dataset.curationIssues ?? []) {
    const id = recordId(record);
    checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
  }
  for (const record of dataset.externalTaxonomyCrosswalks ?? []) {
    const id = recordId(record);
    const taxonId = stringField(record, "taxonId");
    if (taxonId !== undefined) missing(id, "taxa", taxonId);
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "supersedesCrosswalkId",
      "externalTaxonomyCrosswalks",
      missing,
      id,
    );
    checkAllowedSourceManifest(record, id);
  }
  for (const record of dataset.sourceNameDecisions ?? []) {
    const id = recordId(record);
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "supersedesDecisionId",
      "sourceNameDecisions",
      missing,
      id,
    );
    const crosswalkId = stringField(record, "externalTaxonomyCrosswalkId");
    if (crosswalkId !== undefined)
      missing(id, "externalTaxonomyCrosswalks", crosswalkId);
    checkAllowedSourceManifest(record, id);
  }
  for (const record of dataset.sourceSubjectMappings ?? []) {
    const id = recordId(record);
    const decision = stringField(record, "decision");
    if (decision === "map") {
      checkSubject(record.subject, id, false, missing, issues);
    }
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "supersedesMappingId",
      "sourceSubjectMappings",
      missing,
      id,
    );
    const crosswalkId = stringField(record, "externalTaxonomyCrosswalkId");
    if (crosswalkId !== undefined)
      missing(id, "externalTaxonomyCrosswalks", crosswalkId);
    if (decision === "map") checkReviewedNameDecision(record, id, crosswalkId);
    checkAllowedSourceManifest(record, id);
  }
  for (const record of dataset.sourceGeographyDecisions ?? []) {
    const id = recordId(record);
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "supersedesDecisionId",
      "sourceGeographyDecisions",
      missing,
      id,
    );
    if (stringField(record, "decision") === "map") {
      const geographicContextId = stringField(record, "geographicContextId");
      if (geographicContextId !== undefined)
        missing(id, "geographicContexts", geographicContextId);
    }
    checkAllowedSourceManifest(record, id);
  }
  for (const record of dataset.sourceAssertionDecisions ?? []) {
    const id = recordId(record);
    checkReview(stringField(record, "reviewId"), "content", id, get, issues);
    checkReplacement(
      record,
      "supersedesDecisionId",
      "sourceAssertionDecisions",
      missing,
      id,
    );
    if (stringField(record, "decision") === "accept") {
      const assertionId = stringField(record, "assertionId");
      const contextId = stringField(record, "contextId");
      if (assertionId !== undefined) {
        const assertion = get("assertions", assertionId);
        if (assertion === undefined) {
          missing(id, "assertions", assertionId);
        } else if (stringField(assertion, "contextId") !== contextId) {
          issues.push({
            code: "INVALID_SCOPE",
            recordId: id,
            message: `Accepted decision context ${contextId ?? "<missing>"} does not match assertion ${assertionId}`,
          });
        }
      }
      if (contextId !== undefined) missing(id, "contexts", contextId);
    }
  }

  return issues;

  function checkAllowedSourceManifest(record: DatasetRecord, id: string): void {
    const allowed = dataset.sourceManifestIds;
    if (allowed === undefined) return;
    const sourceManifestId =
      stringField(record, "sourceManifestId") ??
      stringField(asRecord(record.externalIdentifier), "sourceManifestId");
    if (sourceManifestId === undefined || !allowed.includes(sourceManifestId)) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId: id,
        message: `References source manifest ${sourceManifestId ?? "<missing>"} outside this curation dataset`,
      });
    }
  }

  function checkReviewedNameDecision(
    mapping: DatasetRecord,
    id: string,
    crosswalkId: string | undefined,
  ): void {
    const sourceId = stringField(mapping, "sourceId");
    const sourceManifestId = stringField(mapping, "sourceManifestId");
    const sourceReleaseId = stringField(mapping, "sourceReleaseId");
    const sourceRecordId = stringField(mapping, "sourceRecordId");
    const reviewed = (dataset.sourceNameDecisions ?? []).some(
      (decision) =>
        stringField(decision, "sourceId") === sourceId &&
        stringField(decision, "sourceManifestId") === sourceManifestId &&
        stringField(decision, "sourceReleaseId") === sourceReleaseId &&
        stringField(decision, "sourceRecordId") === sourceRecordId &&
        !["unresolved", "reject"].includes(
          stringField(decision, "decision") ?? "",
        ) &&
        (crosswalkId === undefined ||
          stringField(decision, "externalTaxonomyCrosswalkId") === crosswalkId),
    );
    if (!reviewed) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId: id,
        message:
          "An accepted source-subject mapping requires an accepted source-name decision for the same source record.",
      });
    }
  }

  function validateScopedRecord(
    record: DatasetRecord,
    ownKind: string,
    supersessionField: string,
    supersededKind: string,
    validateValue: (
      record: DatasetRecord,
      issues: DatasetValidationIssue[],
    ) => void,
  ): void {
    const id = recordId(record);
    checkSubject(record.subject, id, false, missing, issues);
    checkContextAndEvidence(record, id, missing);
    checkContentReview(record, id, get, issues);
    validateValue(record, issues);
    const currentSubject = asRecord(record.subject);
    for (const supersededId of stringArray(record[supersessionField])) {
      const superseded = get(supersededKind, supersededId);
      if (superseded === undefined) {
        missing(id, supersededKind, supersededId);
        continue;
      }
      if (
        currentSubject === undefined ||
        !isSameOrAncestorSubject(
          asRecord(superseded.subject),
          currentSubject,
          get,
        )
      ) {
        issues.push({
          code: "INVALID_SUPERSESSION",
          recordId: id,
          message: `${ownKind} record ${id} may supersede only a record on the same or an ancestor subject`,
        });
      }
    }
  }
}

function checkAcceptedTaxonomicNames(
  dataset: ValidationDataset,
  issues: DatasetValidationIssue[],
): void {
  const activeAcceptedNames = new Map<string, DatasetRecord[]>();
  for (const name of dataset.taxonomicNames ?? []) {
    if (
      stringField(name, "status") !== "active" ||
      stringField(name, "nameStatus") !== "accepted"
    ) {
      continue;
    }
    const taxonId = stringField(name, "taxonId");
    if (taxonId === undefined) continue;
    const names = activeAcceptedNames.get(taxonId) ?? [];
    names.push(name);
    activeAcceptedNames.set(taxonId, names);
  }

  for (const taxon of dataset.taxa) {
    if (stringField(taxon, "status") !== "active") continue;
    const taxonId = recordId(taxon);
    const names = activeAcceptedNames.get(taxonId) ?? [];
    if (names.length === 0) {
      issues.push({
        code: "INVALID_TAXONOMIC_NAME",
        recordId: taxonId,
        message: `Active taxon ${taxonId} requires one active accepted taxonomic name`,
      });
      continue;
    }
    if (names.length > 1) {
      issues.push({
        code: "DUPLICATE_ACCEPTED_TAXONOMIC_NAME",
        recordId: taxonId,
        message: `Active taxon ${taxonId} has more than one active accepted taxonomic name`,
      });
      continue;
    }
    const acceptedScientificName = stringField(names[0], "scientificName");
    if (stringField(taxon, "scientificName") !== acceptedScientificName) {
      issues.push({
        code: "INVALID_TAXONOMIC_NAME",
        recordId: taxonId,
        message: `Taxon scientificName must equal its active accepted taxonomic name ${acceptedScientificName ?? "<missing>"}`,
      });
    }
  }
}

function checkSubject(
  value: unknown,
  recordId: string,
  allowTaxon: boolean,
  missing: (recordId: string, kind: string, id: string) => void,
  issues: DatasetValidationIssue[],
): void {
  const subject = asRecord(value);
  const type = stringField(subject, "type");
  const id = stringField(subject, "id");
  const kind = subjectCollection(type, allowTaxon);
  if (kind === undefined || id === undefined) {
    issues.push({
      code: "INVALID_SCOPE",
      recordId,
      message: `Subject ${type ?? "<missing>"}/${id ?? "<missing>"} is not a valid catalog subject`,
    });
    return;
  }
  missing(recordId, kind, id);
}

function subjectCollection(
  type: string | undefined,
  allowTaxon: boolean,
): string | undefined {
  if (type === "plant-concept") return "plantConcepts";
  if (type === "cultivar-group") return "cultivarGroups";
  if (type === "cultivar") return "cultivars";
  if (allowTaxon && type === "taxon") return "taxa";
  return undefined;
}

function checkContextAndEvidence(
  record: DatasetRecord,
  id: string,
  missing: (recordId: string, kind: string, targetId: string) => void,
): void {
  const contextId = stringField(record, "contextId");
  if (contextId !== undefined) missing(id, "contexts", contextId);
  checkIdReferences(record, "evidenceReferenceIds", "evidence", missing, id);
}

function checkContentReview(
  record: DatasetRecord,
  id: string,
  get: (kind: string, targetId: string) => DatasetRecord | undefined,
  issues: DatasetValidationIssue[],
): void {
  const reviewId = stringField(record, "reviewId");
  if (reviewId !== undefined) checkReview(reviewId, "content", id, get, issues);
}

function checkReview(
  reviewId: string | undefined,
  expectedPurpose: "content" | "rights",
  recordId: string,
  get: (kind: string, id: string) => DatasetRecord | undefined,
  issues: DatasetValidationIssue[],
): void {
  if (reviewId === undefined) {
    issues.push({
      code: "MISSING_REFERENCE",
      recordId,
      message: `References missing ${expectedPurpose} review`,
    });
    return;
  }
  const review = get("reviews", reviewId);
  if (review === undefined) {
    issues.push({
      code: "MISSING_REFERENCE",
      recordId,
      message: `References missing reviews record ${reviewId}`,
    });
    return;
  }
  if (stringField(review, "purpose") !== expectedPurpose) {
    issues.push({
      code: "INVALID_REVIEW_REFERENCE",
      recordId,
      message: `Review ${reviewId} must have purpose ${expectedPurpose}`,
    });
  }
}

function checkIdReferences(
  record: DatasetRecord,
  field: string,
  kind: string,
  missing: (recordId: string, targetKind: string, id: string) => void,
  id: string,
): void {
  for (const targetId of stringArray(record[field]))
    missing(id, kind, targetId);
}

function checkReplacement(
  record: DatasetRecord,
  field: string,
  kind: string,
  missing: (recordId: string, targetKind: string, id: string) => void,
  id: string,
): void {
  const targetId = stringField(record, field);
  if (targetId !== undefined) missing(id, kind, targetId);
}

function checkPreferredNames(
  names: readonly DatasetRecord[],
  issues: DatasetValidationIssue[],
): void {
  const preferred = new Set<string>();
  for (const name of names) {
    if (name.preferred !== true) continue;
    const subject = asRecord(name.subject);
    const key = `${stringField(subject, "type") ?? ""}/${stringField(subject, "id") ?? ""}/${stringField(name, "languageTag") ?? ""}`;
    if (preferred.has(key)) {
      issues.push({
        code: "DUPLICATE_PREFERRED_NAME",
        recordId: recordId(name),
        message: `More than one preferred localized name is declared for ${key}`,
      });
    }
    preferred.add(key);
  }
}

function checkParentCycles(
  record: DatasetRecord,
  field: string,
  kind: string,
  get: (kind: string, id: string) => DatasetRecord | undefined,
  issues: DatasetValidationIssue[],
): void {
  const rootId = stringField(record, "id");
  if (rootId === undefined) return;
  const visit = (id: string, path: Set<string>): boolean => {
    if (path.has(id)) return true;
    const current = get(kind, id);
    if (current === undefined) return false;
    const nextPath = new Set(path).add(id);
    return stringArray(current[field]).some((parentId) =>
      visit(parentId, nextPath),
    );
  };
  if (visit(rootId, new Set())) {
    issues.push({
      code: "INVALID_SCOPE",
      recordId: rootId,
      message: "Geographic context parent links contain a cycle",
    });
  }
}

function isSameOrAncestorSubject(
  ancestor: DatasetRecord | undefined,
  child: DatasetRecord,
  get: (kind: string, id: string) => DatasetRecord | undefined,
): boolean {
  if (ancestor === undefined) return false;
  const ancestorType = stringField(ancestor, "type");
  const ancestorId = stringField(ancestor, "id");
  const childType = stringField(child, "type");
  const childId = stringField(child, "id");
  if (
    ancestorType === undefined ||
    ancestorId === undefined ||
    childId === undefined
  )
    return false;
  if (ancestorType === childType && ancestorId === childId) return true;
  const ancestors = ancestorSubjects(childType, childId, get);
  return ancestors.some(
    (candidate) =>
      candidate.type === ancestorType && candidate.id === ancestorId,
  );
}

function ancestorSubjects(
  type: string | undefined,
  id: string,
  get: (kind: string, targetId: string) => DatasetRecord | undefined,
): { type: string; id: string }[] {
  if (type === "plant-concept") return [];
  const kind = subjectCollection(type, false);
  if (kind === undefined) return [];
  const record = get(kind, id);
  if (record === undefined) return [];
  const parents: { type: string; id: string }[] = [];
  const plantConceptId = stringField(record, "plantConceptId");
  if (plantConceptId !== undefined)
    parents.push({ type: "plant-concept", id: plantConceptId });
  if (type === "cultivar") {
    for (const groupId of stringArray(record.cultivarGroupIds)) {
      parents.push({ type: "cultivar-group", id: groupId });
    }
  }
  return parents;
}

function checkFactValue(
  record: DatasetRecord,
  issues: DatasetValidationIssue[],
): void {
  const predicate = stringField(record, "predicate");
  const value = record.value;
  const id = recordId(record);
  if (
    [
      "sowing_window",
      "transplant_window",
      "harvest_window",
      "growing_degree_days",
    ].includes(predicate ?? "")
  ) {
    checkRuleValue({ id, timing: value }, issues);
  }
  if (
    predicate === "growing_temperature" &&
    !isValidTemperatureProfile(value)
  ) {
    issues.push({
      code: "INVALID_TEMPERATURE_PROFILE",
      recordId: id,
      message:
        "Temperature values must use Celsius with ordered, source-supported bounds.",
    });
  }
  if (
    predicate === "minimum_germination_temperature" &&
    !isTemperature(value)
  ) {
    issues.push({
      code: "INVALID_TEMPERATURE_PROFILE",
      recordId: id,
      message:
        "Minimum germination temperature must be an explicit Celsius quantity.",
    });
  }
  if (
    predicate === "germination_profile" &&
    !isValidGerminationProfile(value)
  ) {
    issues.push({
      code: "INVALID_GERMINATION_PROFILE",
      recordId: id,
      message:
        "Germination profiles must use valid Celsius and/or day values with ordered bounds.",
    });
  }
  const valueRecord = asRecord(value);
  if (predicate === "soil_ph_range" && valueRecord !== undefined) {
    if (
      numberField(valueRecord, "minimum") > numberField(valueRecord, "maximum")
    ) {
      issues.push({
        code: "INVALID_VALUE_RANGE",
        recordId: id,
        message: "Soil pH minimum exceeds its maximum.",
      });
    }
  }
  if (
    [
      "mature_height",
      "mature_spread",
      "spacing",
      "germination_days",
      "days_to_first_harvest",
    ].includes(predicate ?? "") &&
    valueRecord !== undefined
  ) {
    if (
      hasNumber(valueRecord.minimum) &&
      hasNumber(valueRecord.maximum) &&
      valueRecord.minimum > valueRecord.maximum
    ) {
      issues.push({
        code: "INVALID_VALUE_RANGE",
        recordId: id,
        message: "The value minimum exceeds its maximum.",
      });
    }
  }
}

function checkRuleValue(
  record: DatasetRecord,
  issues: DatasetValidationIssue[],
): void {
  const timing = asRecord(record.timing);
  if (timing === undefined) return;
  const id = recordId(record);
  if (timing.type === "relative-day-window") {
    if (
      numberField(timing, "startOffsetDays") >
      numberField(timing, "endOffsetDays")
    ) {
      issues.push({
        code: "INVALID_VALUE_RANGE",
        recordId: id,
        message: "Relative timing start exceeds its end.",
      });
    }
  }
  if (timing.type === "calendar-date-window") {
    if (!validMonthDay(timing.start) || !validMonthDay(timing.end)) {
      issues.push({
        code: "INVALID_CALENDAR_VALUE",
        recordId: id,
        message: "Calendar windows must use real month/day combinations.",
      });
    }
  }
  if (timing.type === "soil-temperature-threshold") {
    const range = asRecord(timing.temperatureRange);
    if (
      range !== undefined &&
      numberField(range, "minimum") > numberField(range, "maximum")
    ) {
      issues.push({
        code: "INVALID_VALUE_RANGE",
        recordId: id,
        message: "Soil temperature minimum exceeds its maximum.",
      });
    }
  }
}

function validMonthDay(value: unknown): boolean {
  const monthDay = asRecord(value);
  const month =
    monthDay === undefined ? Number.NaN : numberField(monthDay, "month");
  const day =
    monthDay === undefined ? Number.NaN : numberField(monthDay, "day");
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return (
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    daysInMonth !== undefined &&
    day >= 1 &&
    day <= daysInMonth
  );
}

function isTemperature(value: unknown): boolean {
  const record = asRecord(value);
  return (
    record !== undefined &&
    typeof record.value === "number" &&
    record.unit === "Cel"
  );
}

function recordId(record: DatasetRecord): string {
  return stringField(record, "id") ?? "<missing>";
}

function stringField(
  record: DatasetRecord | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: DatasetRecord, field: string): number {
  const value = record[field];
  return typeof value === "number" ? value : Number.NaN;
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): DatasetRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DatasetRecord)
    : undefined;
}
