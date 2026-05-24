import type { AppBskyNotificationListNotifications } from '@atproto/api';

type Notification = AppBskyNotificationListNotifications.Notification;

function subjectUri(
  notification: Notification,
): string | undefined {
  const subject = notification.record?.subject;
  if (subject && typeof subject === 'object' && 'uri' in subject) {
    const uri = subject.uri;
    return typeof uri === 'string' ? uri : undefined;
  }
  return undefined;
}

function postUri(uri: string | undefined): string | undefined {
  return uri?.includes('/app.bsky.feed.post/') ? uri : undefined;
}

export function notificationPostUri(
  notification: Notification,
): string | undefined {
  if (notification.reason === 'like-via-repost') {
    return postUri(subjectUri(notification)) || postUri(notification.reasonSubject);
  }
  if (notification.reason === 'repost-via-repost') {
    return postUri(subjectUri(notification)) || postUri(notification.reasonSubject);
  }
  if (notification.reason === 'like' || notification.reason === 'repost') {
    return postUri(notification.reasonSubject) || postUri(subjectUri(notification));
  }
  if (
    notification.reason === 'quote' ||
    notification.reason === 'reply' ||
    notification.reason === 'mention'
  ) {
    return postUri(notification.uri) || postUri(notification.reasonSubject);
  }
  return (
    postUri(notification.reasonSubject) ||
    postUri(subjectUri(notification)) ||
    postUri(notification.uri)
  );
}
