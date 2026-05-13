import './annual-report.css';

import { Trans } from '@lingui/react/macro';
import type { ComponentChildren, ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useParams } from 'react-router-dom';

import Link from '../components/link';
import NameTextUntyped from '../components/name-text';
import StatusUntyped from '../components/status';
import { api } from '../utils/api';
import useTitle from '../utils/useTitle';

const NameText = NameTextUntyped as unknown as ComponentType<{
  account?: unknown;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (event: Event) => void;
  [key: string]: unknown;
}>;

const Status = StatusUntyped as unknown as ComponentType<{
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  showCommentCount?: boolean;
  [key: string]: unknown;
}>;

interface AnnualReportAccount {
  id: string;
  [key: string]: unknown;
}

interface AnnualReportStatus {
  id: string;
  [key: string]: unknown;
}

interface AnnualReportEntry {
  year: string | number;
  data: Record<string, unknown>;
}

interface AnnualReportResponse {
  accounts?: AnnualReportAccount[];
  annualReports?: AnnualReportEntry[];
  statuses?: AnnualReportStatus[];
}

export default function AnnualReport() {
  const params = useParams<{ year?: string }>();
  const { year } = params;
  useTitle(
    year ? `${year} #Wrapstodon` : '#Wrapstodon',
    '/annual_report/:year',
  );
  const { masto, instance } = api();
  const [results, setResults] = useState<AnnualReportResponse | null>(null);
  const [uiState, setUIState] = useState<string>('default');

  useEffect(() => {
    if (year) {
      (async () => {
        setUIState('loading');
        const mastoUntyped = masto as unknown as {
          v1: {
            annualReports: {
              $select(year: string): {
                fetch(): Promise<AnnualReportResponse>;
              };
            };
          };
        };
        const fetched = await mastoUntyped.v1.annualReports
          .$select(year)
          .fetch();
        console.log('REPORT', fetched);
        setResults(fetched);
        setUIState('default');
      })();
    }
  }, [year]);

  const { accounts, annualReports, statuses } = results || {};
  const report = annualReports?.find((report) => report.year == year)?.data;

  const datePlaceholder = new Date();

  return (
    <div id="annual-report-page" class="deck-container" tabIndex={-1}>
      <div class={`report ${uiState === 'loading' ? 'loading-mask' : ''}`}>
        <h1>{year} #Wrapstodon</h1>
        {!!report && (
          <dl>
            {Object.entries(report).map(([key, value]) => {
              console.log('value', value);
              const totals: Record<string, number> = {};
              if (Array.isArray(value)) {
                value.forEach((item) => {
                  Object.entries(item as Record<string, unknown>).forEach(
                    ([k, v]) => {
                      if (typeof v === 'number') {
                        totals[k] = (totals[k] || 0) + v;
                      }
                    },
                  );
                });
              }

              return (
                <>
                  <dt>{key}</dt>
                  <dd class={`report-${key}`}>
                    {Array.isArray(value) ? (
                      <table>
                        <thead>
                          <tr>
                            {Object.entries(
                              value[0] as Record<string, unknown>,
                            ).map(([key, value]) => (
                              <th
                                class={
                                  key !== 'month' && typeof value === 'number'
                                    ? 'number'
                                    : ''
                                }
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {value.map((item) => (
                            <tr>
                              {Object.entries(
                                item as Record<string, unknown>,
                              ).map(([k, value]) => (
                                <td
                                  class={
                                    k !== 'month' && typeof value === 'number'
                                      ? 'number'
                                      : ''
                                  }
                                  style={{
                                    '--percentage':
                                      typeof value === 'number'
                                        ? `${(value / totals[k]) * 100}%`
                                        : 0,
                                  }}
                                >
                                  {value &&
                                  /(accountId)/i.test(k) &&
                                  /^(mostRebloggedAccounts|commonlyInteractedWithAccounts)$/i.test(
                                    key,
                                  ) ? (
                                    accounts?.find((a) => a.id === value) ? (
                                      <NameText
                                        account={accounts?.find(
                                          (a) => a.id === value,
                                        )}
                                        showAvatar
                                      />
                                    ) : (
                                      '👻'
                                    )
                                  ) : k === 'month' ? (
                                    datePlaceholder.setMonth(
                                      (value as number) - 1,
                                    ) &&
                                    datePlaceholder.toLocaleString(undefined, {
                                      month: 'long',
                                    })
                                  ) : typeof value === 'number' ? (
                                    value.toLocaleString()
                                  ) : (
                                    (value as ComponentChildren)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : typeof value === 'object' ? (
                      /^(topStatuses)$/i.test(key) ? (
                        <dl>
                          {Object.entries(
                            value as Record<string, unknown>,
                          ).map(([k, value]) => (
                            <>
                              <dt>{k}</dt>
                              <dd>
                                {
                                  (value && (
                                    <Link to={`/${instance}/s/${value}`}>
                                      <Status
                                        status={statuses?.find(
                                          (s) => s.id === value,
                                        )}
                                        size="s"
                                        readOnly
                                        showCommentCount
                                      />
                                    </Link>
                                  )) as ComponentChildren
                                }
                              </dd>
                            </>
                          ))}
                        </dl>
                      ) : (
                        <table>
                          <tbody>
                            {Object.entries(
                              value as Record<string, unknown>,
                            ).map(([k, value]) => (
                              <tr>
                                <th>{k}</th>
                                <td
                                  class={
                                    typeof value === 'number' ? 'number' : ''
                                  }
                                >
                                  {value as ComponentChildren}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    ) : typeof value === 'string' ? (
                      value
                    ) : (
                      // Last resort
                      JSON.stringify(value, null, 2)
                    )}
                  </dd>
                </>
              );
            })}
          </dl>
        )}
      </div>
      <hr />
      <p style={{ textAlign: 'center' }}>
        <Link to="/">
          <Trans>Go home</Trans>
        </Link>
      </p>
    </div>
  );
}
