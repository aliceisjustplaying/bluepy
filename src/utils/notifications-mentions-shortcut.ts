export interface MentionsShortcutNotification {
  type?: string;
  createdAt?: string;
  notificationsCount?: number;
}

export function shouldShowMentionsShortcut(
  notifications: MentionsShortcutNotification[],
): boolean {
  const totalNotifications = notifications.length;
  const totalMentions = notifications.filter(
    (notification) => notification.type === 'mention',
  ).length;
  const mentionsCountPerDay: Record<string, number> = {};
  const notificationCountPerHour: Record<string, number> = {};
  let tooManyNotificationsPerHour = false;

  for (const notification of notifications) {
    const { createdAt, notificationsCount, type } = notification;
    if (!createdAt) continue;
    const notificationCount = notificationsCount ?? 1;
    const date = new Date(createdAt);
    const dayKey = date.toDateString();
    const hourKey = date.toISOString().slice(0, 13);

    if (type === 'mention') {
      mentionsCountPerDay[dayKey] = (mentionsCountPerDay[dayKey] || 0) + 1;
    }

    notificationCountPerHour[hourKey] =
      (notificationCountPerHour[hourKey] || 0) + notificationCount;
    if (notificationCountPerHour[hourKey] > 30) {
      tooManyNotificationsPerHour = true;
    }
  }

  const mentionsPercentage =
    totalNotifications > 0 ? totalMentions / totalNotifications : 0;
  const littleMentions = mentionsPercentage < 0.33;
  const tooManyMentionsPerDay = Object.values(mentionsCountPerDay).some(
    (count) => count > 30,
  );
  const tooManyNotificationsPerGroupNotification = notifications.some(
    (notification) => (notification.notificationsCount ?? 0) > 30,
  );

  return (
    littleMentions ||
    tooManyMentionsPerDay ||
    tooManyNotificationsPerGroupNotification ||
    tooManyNotificationsPerHour
  );
}
