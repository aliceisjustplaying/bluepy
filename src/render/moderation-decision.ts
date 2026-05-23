import {
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedDefs,
  AppBskyActorDefs,
  moderatePost,
  moderateProfile,
  type ComAtprotoLabelDefs,
  type InterpretedLabelValueDefinition,
  type ModerationDecision,
  type ModerationOpts,
} from '@atproto/api';

export interface ModerationContext {
  baselineLabelers: readonly { did: string }[];
  subscribedLabelers: readonly { did: string }[];
  acceptedLabelerDids: readonly string[];
  labelDefs: Record<string, InterpretedLabelValueDefinition[]>;
  contentLabelPrefs: AppBskyActorDefs.ContentLabelPref[];
  adultContent: boolean;
  mutedWords: AppBskyActorDefs.MutedWord[];
  hiddenPosts: readonly string[];
  userDid?: string;
}

export interface PostModerationDecision {
  visibility: 'show' | 'warn' | 'blur' | 'hide';
  cause?:
    | 'label'
    | 'muted-word'
    | 'hidden-post'
    | 'blocked-by'
    | 'blocking'
    | 'muted'
    | 'detached'
    | 'not-found';
  blurAlt?: string;
  labels?: ComAtprotoLabelDefs.Label[];
  causeLabel?: ComAtprotoLabelDefs.Label;
}

export interface ProfileModerationDecision {
  visibility: 'show' | 'warn' | 'blur' | 'hide';
  cause?: 'label' | 'blocked-by' | 'blocking' | 'muted';
  avatarBlur?: boolean;
  bannerBlur?: boolean;
  displayNameBlur?: boolean;
  bioBlur?: boolean;
  labels?: ComAtprotoLabelDefs.Label[];
  causeLabel?: ComAtprotoLabelDefs.Label;
}

function isLabelPreference(
  value: string | undefined,
): value is 'hide' | 'warn' | 'ignore' {
  return value === 'hide' || value === 'warn' || value === 'ignore';
}

function moderationContextToOpts(ctx: ModerationContext): ModerationOpts {
  const labels: Record<string, 'ignore' | 'warn' | 'hide'> = {};
  for (const pref of ctx.contentLabelPrefs) {
    if (pref.label && isLabelPreference(pref.visibility)) {
      labels[pref.label] = pref.visibility;
    }
  }

  const seen = new Set<string>();
  const labelers: ModerationOpts['prefs']['labelers'] = [];
  for (const labeler of [...ctx.baselineLabelers, ...ctx.subscribedLabelers]) {
    if (seen.has(labeler.did)) continue;
    seen.add(labeler.did);
    labelers.push({
      did: labeler.did,
      labels: { ...labels },
    });
  }

  return {
    userDid: ctx.userDid,
    prefs: {
      adultContentEnabled: ctx.adultContent,
      labels,
      labelers,
      mutedWords: [...ctx.mutedWords],
      hiddenPosts: [...ctx.hiddenPosts],
    },
    labelDefs: ctx.labelDefs,
  };
}

function filterLabels(
  labels: ComAtprotoLabelDefs.Label[] | undefined,
  acceptedLabelerDids: readonly string[],
): ComAtprotoLabelDefs.Label[] {
  if (!labels?.length) return [];
  const accepted = new Set(acceptedLabelerDids);
  return labels.filter((label) => accepted.has(label.src));
}

function embedCause(
  post: AppBskyFeedDefs.PostView,
): PostModerationDecision['cause'] | undefined {
  const embed = post.embed;
  if (!embed) return undefined;

  const record =
    AppBskyEmbedRecord.isView(embed) || AppBskyEmbedRecordWithMedia.isView(embed)
      ? AppBskyEmbedRecord.isView(embed)
        ? embed.record
        : AppBskyEmbedRecord.isView(embed.record)
          ? embed.record.record
          : undefined
      : undefined;

  if (!record || typeof record !== 'object') return undefined;
  const type = (record as { $type?: string }).$type ?? '';
  if (type.endsWith('#viewDetached')) return 'detached';
  if (type.endsWith('#viewNotFound')) return 'not-found';
  return undefined;
}

function causeMatches(
  cause: ModerationDecision['causes'][number],
  candidate: PostModerationDecision['cause'],
): boolean {
  if (candidate === 'hidden-post') return cause.type === 'hidden';
  if (candidate === 'muted-word') return cause.type === 'mute-word';
  if (candidate === 'blocking') {
    return cause.type === 'blocking' || cause.type === 'block-other';
  }
  if (candidate === 'blocked-by') return cause.type === 'blocked-by';
  if (candidate === 'muted') return cause.type === 'muted';
  if (candidate === 'label') return cause.type === 'label';
  return false;
}

function mapPostCauseType(
  mod: ModerationDecision,
): PostModerationDecision['cause'] {
  const priority: PostModerationDecision['cause'][] = [
    'hidden-post',
    'muted-word',
    'blocking',
    'blocked-by',
    'muted',
    'label',
  ];
  for (const candidate of priority) {
    if (mod.causes.some((cause) => causeMatches(cause, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

function mapProfileCauseType(
  mod: ModerationDecision,
): ProfileModerationDecision['cause'] {
  const cause = mapPostCauseType(mod);
  if (
    cause === 'label' ||
    cause === 'blocked-by' ||
    cause === 'blocking' ||
    cause === 'muted'
  ) {
    return cause;
  }
  return undefined;
}

function mapVisibility(
  mod: ModerationDecision,
  context: 'contentView' | 'profileView',
): 'show' | 'warn' | 'blur' | 'hide' {
  const ui = mod.ui(context);
  if (ui.filters.length > 0) return 'hide';
  if (ui.blurs.length > 0) return 'blur';
  if (ui.alerts.length > 0) return 'warn';
  if (ui.informs.length > 0) return 'warn';
  if (mod.causes.length > 0) return 'warn';
  return 'show';
}

function labelCause(mod: ModerationDecision): ComAtprotoLabelDefs.Label | undefined {
  const labelCauseEntry = mod.causes.find((cause) => cause.type === 'label');
  if (labelCauseEntry?.type === 'label') return labelCauseEntry.label;
  return undefined;
}

export function decidePostModeration(
  post: AppBskyFeedDefs.PostView,
  ctx: ModerationContext,
): PostModerationDecision {
  const embedOnlyCause = embedCause(post);
  if (embedOnlyCause) {
    return {
      visibility: embedOnlyCause === 'not-found' ? 'hide' : 'blur',
      cause: embedOnlyCause,
      blurAlt:
        embedOnlyCause === 'detached'
          ? 'Quoted post was detached'
          : 'Quoted post not found',
    };
  }

  const mod = moderatePost(post, moderationContextToOpts(ctx));
  const labels = filterLabels(post.labels, ctx.acceptedLabelerDids);
  const visibility = mapVisibility(mod, 'contentView');
  const cause = mapPostCauseType(mod);

  return {
    visibility,
    cause,
    labels,
    causeLabel: labelCause(mod),
    blurAlt:
      visibility === 'blur' || visibility === 'hide'
        ? 'Content hidden by moderation settings'
        : undefined,
  };
}

function profileFieldBlurred(
  mod: ModerationDecision,
  context: 'avatar' | 'banner' | 'displayName' | 'profileView',
): boolean {
  const ui = mod.ui(context);
  return ui.blurs.length > 0 || ui.noOverride;
}

export function decideProfileModeration(
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed,
  ctx: ModerationContext,
): ProfileModerationDecision {
  const mod = moderateProfile(profile, moderationContextToOpts(ctx));
  const labels = filterLabels(profile.labels, ctx.acceptedLabelerDids);
  const visibility = mapVisibility(mod, 'profileView');

  return {
    visibility,
    cause: mapProfileCauseType(mod),
    labels,
    causeLabel: labelCause(mod),
    avatarBlur: profileFieldBlurred(mod, 'avatar'),
    bannerBlur: profileFieldBlurred(mod, 'banner'),
    displayNameBlur: profileFieldBlurred(mod, 'displayName'),
    bioBlur: profileFieldBlurred(mod, 'profileView'),
  };
}
