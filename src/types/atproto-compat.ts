type JsonRecord = Record<string, unknown>;

export namespace AtprotoCompat {
  export namespace v1 {
    export interface Role extends Record<string, unknown> {
      name?: string;
    }

    export interface AccountField {
      name: string;
      value: string;
      verifiedAt?: string | null;
    }

    export interface CustomEmoji {
      shortcode: string;
      url: string;
      staticUrl?: string;
      visibleInPicker?: boolean;
    }

    export interface Account {
      id: string;
      acct: string;
      username: string;
      url: string;
      uri: string;
      displayName: string;
      avatar: string;
      avatarStatic: string;
      header: string;
      headerStatic: string;
      note: string;
      fields: AccountField[];
      emojis: CustomEmoji[];
      followersCount: number;
      followingCount: number;
      statusesCount: number;
      bot: boolean;
      locked: boolean;
      group: boolean;
      createdAt: string;
      lastStatusAt: string | null;
      roles?: Role[];
      memorial?: boolean;
      moved?: Account | null;
    }

    export interface Relationship {
      id: string;
      following?: boolean;
      followedBy?: boolean;
      requested?: boolean;
      blocking?: boolean;
      blockedBy?: boolean;
      muting?: boolean;
      mutingNotifications?: boolean;
      showingReblogs?: boolean;
      notifying?: boolean;
      domainBlocking?: boolean;
      note?: string;
    }

    export interface MediaAttachment {
      id: string;
      type: 'image' | 'video' | 'gifv' | 'audio' | 'unknown';
      url: string;
      previewUrl: string;
      previewRemoteUrl?: string;
      remoteUrl?: string | null;
      description?: string | null;
      blurhash?: string | null;
      meta?: JsonRecord;
    }

    export interface PollOption {
      title: string;
      votesCount?: number;
    }

    export interface Poll {
      id: string;
      options: PollOption[];
      expired: boolean;
      expiresAt?: string | null;
      multiple: boolean;
      voted: boolean;
      votesCount: number;
      votersCount: number | null;
      ownVotes: number[];
      emojis?: CustomEmoji[];
    }

    export interface PreviewCard {
      url: string;
      title?: string;
      description?: string;
      image?: string;
      type?: string;
    }

    export interface StatusMention {
      id: string;
      acct: string;
      username: string;
      url?: string;
    }

    export interface Tag {
      name: string;
      url?: string;
      history?: { uses: string | number }[];
    }

    export interface Filter {
      context: string[];
      expiresAt?: string | null;
      filterAction?: 'blur' | 'hide' | 'warn' | string;
      title: string;
    }

    export interface FilterResult {
      filter: Filter;
      keywordMatches?: string[] | null;
      statusMatches?: string[] | null;
    }

    export interface Quote {
      state?: string;
      quotedStatus?: Status | null;
    }

    export interface Status {
      id: string;
      uri: string;
      url?: string | null;
      createdAt: string;
      account: Account;
      content: string;
      text: string;
      spoilerText: string;
      visibility: 'direct' | 'local' | 'private' | 'public' | 'unlisted';
      sensitive: boolean;
      language?: string | null;
      mediaAttachments: MediaAttachment[];
      mentions: StatusMention[];
      tags: Tag[];
      emojis: CustomEmoji[];
      card?: PreviewCard | null;
      poll?: Poll | null;
      quote?: Quote | null;
      reblog?: Status | null;
      application?: JsonRecord | null;
      favourited: boolean;
      reblogged: boolean;
      bookmarked: boolean;
      muted: boolean;
      pinned: boolean;
      repliesCount: number;
      reblogsCount: number;
      favouritesCount: number;
      quotesCount: number;
      inReplyToId: string | null;
      inReplyToAccountId: string | null;
      filtered?: FilterResult[] | null;
      editedAt?: string | null;
      emojiReactions?: readonly JsonRecord[];
    }

    export interface FeaturedTag {
      id: string;
      name: string;
      url?: string;
      statusesCount?: number;
    }

    export interface FamiliarFollowers {
      id: string;
      accounts: Account[];
    }

    export interface Notification {
      id: string;
      type: string;
      account: Account;
      status?: Status | null;
      createdAt?: string;
    }
  }

  export namespace v2 {
    export interface NotificationGroup extends v1.Notification {
      groupedNotifications?: v1.Notification[];
      sampleAccountIds?: string[];
      statusId?: string;
    }
  }

  export namespace rest {
    interface AsyncList<T> {
      values(): AsyncIterator<T[]>;
    }

    export namespace v1 {
      export interface AccountsResource {
        $select(id: string): {
          fetch(): Promise<AtprotoCompat.v1.Account>;
          statuses: {
            list(params?: JsonRecord): AsyncList<AtprotoCompat.v1.Status>;
          };
          followers: {
            list(params?: JsonRecord): AsyncList<AtprotoCompat.v1.Account>;
          };
          following: {
            list(params?: JsonRecord): AsyncList<AtprotoCompat.v1.Account>;
          };
          featuredTags: {
            list(params?: JsonRecord): Promise<AtprotoCompat.v1.FeaturedTag[]>;
          };
        };
        lookup(params: JsonRecord): Promise<AtprotoCompat.v1.Account>;
        relationships: {
          fetch(params: JsonRecord): Promise<AtprotoCompat.v1.Relationship[]>;
        };
        familiarFollowers: {
          fetch(
            params: JsonRecord,
          ): Promise<AtprotoCompat.v1.FamiliarFollowers[]>;
        };
        updateCredentials(
          params: JsonRecord,
        ): Promise<AtprotoCompat.v1.Account>;
      }

      export interface StatusesResource {
        $select(id: string): {
          fetch(): Promise<AtprotoCompat.v1.Status>;
          context: {
            fetch(): Promise<JsonRecord>;
          };
        };
        list(params: {
          id: readonly string[];
        }): Promise<AtprotoCompat.v1.Status[]>;
      }

      export interface BookmarksResource {
        list(params?: JsonRecord): AsyncList<AtprotoCompat.v1.Status>;
      }

      export interface FavouritesResource {
        list(params?: JsonRecord): AsyncList<AtprotoCompat.v1.Status>;
      }

      export type ListAccountStatusesParams = JsonRecord;
    }

    export namespace v2 {
      export interface SearchResource {
        list(params: JsonRecord): Promise<{
          accounts: AtprotoCompat.v1.Account[];
          hashtags: AtprotoCompat.v1.Tag[];
          statuses: AtprotoCompat.v1.Status[];
        }>;
      }
    }
  }
}
