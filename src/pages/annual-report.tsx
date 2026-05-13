import './annual-report.css';

import { Trans } from '@lingui/react/macro';
import { Fragment, type ComponentChildren, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useParams } from 'react-router-dom';

import Link from '../components/link';
import NameTextUntyped from '../components/name-text';
import StatusUntyped from '../components/status';
import { api } from '../utils/api';
import useTitle from '../utils/useTitle';

function NameText(props: {
  account?: unknown;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (event: Event) => void;
  [key: string]: unknown;
}) {
  const Inner = NameTextUntyped as unknown as ComponentType<{
    account?: unknown;
    instance?: string;
    showAvatar?: boolean;
    showAcct?: boolean;
    short?: boolean;
    external?: boolean;
    onClick?: (event: Event) => void;
    [key: string]: unknown;
  }>;
  return <Inner {...props} />;
}

function Status(props: {
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  showCommentCount?: boolean;
  [key: string]: unknown;
}) {
  const Inner = StatusUntyped as unknown as ComponentType<{
    status?: unknown;
    size?: string;
    readOnly?: boolean;
    showCommentCount?: boolean;
    [key: string]: unknown;
  }>;
  return <Inner {...props} />;
}

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
      void (async () => {
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
    // TODO(oxlint:react-hooks/exhaustive-deps): `masto` is a masto client
    // proxy recreated per-access; adding it to deps would refetch on every
    // render. The api() singleton is stable for the current instance.
  }, [year]);

  const { accounts, annualReports, statuses } = results || {};
  const report = annualReports?.find((entry) => entry.year == year)?.data;

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
                <Fragment key={key}>
                  <dt>{key}</dt>
                  <dd class={`report-${key}`}>
                    {Array.isArray(value) ? (
                      <table>
                        <thead>
                          <tr>
                            {Object.entries(
                              value[0] as Record<string, unknown>,
                            ).map(([colKey, colValue]) => (
                              <th
                                key={colKey}
                                class={
                                  colKey !== 'month' &&
                                  typeof colValue === 'number'
                                    ? 'number'
                                    : ''
                                }
                              >
                                {colKey}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {value.map((item, rowIndex) => (
                            <tr key={rowIndex}>
                              {Object.entries(
                                item as Record<string, unknown>,
                              ).map(([k, cellValue]) => (
                                <td
                                  key={k}
                                  class={
                                    k !== 'month' &&
                                    typeof cellValue === 'number'
                                      ? 'number'
                                      : ''
                                  }
                                  style={{
                                    '--percentage':
                                      typeof cellValue === 'number'
                                        ? `${(cellValue / totals[k]) * 100}%`
                                        : 0,
                                  }}
                                >
                                  {cellValue &&
                                  /(accountId)/i.test(k) &&
                                  /^(mostRebloggedAccounts|commonlyInteractedWithAccounts)$/i.test(
                                    key,
                                  ) ? (
                                    accounts?.find(
                                      (a) => a.id === cellValue,
                                    ) ? (
                                      <NameText
                                        account={accounts?.find(
                                          (a) => a.id === cellValue,
                                        )}
                                        showAvatar
                                      />
                                    ) : (
                                      '👻'
                                    )
                                  ) : k === 'month' ? (
                                    datePlaceholder.setMonth(
                                      (cellValue as number) - 1,
                                    ) &&
                                    datePlaceholder.toLocaleString(undefined, {
                                      month: 'long',
                                    })
                                  ) : typeof cellValue === 'number' ? (
                                    cellValue.toLocaleString()
                                  ) : (
                                    (cellValue as ComponentChildren)
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
                          {Object.entries(value as Record<string, unknown>).map(
                            ([k, statusId]) => (
                              <Fragment key={k}>
                                <dt>{k}</dt>
                                <dd>
                                  {
                                    (statusId &&
                                      typeof statusId === 'string' && (
                                        <Link to={`/${instance}/s/${statusId}`}>
                                          <Status
                                            status={statuses?.find(
                                              (s) => s.id === statusId,
                                            )}
                                            size="s"
                                            readOnly
                                            showCommentCount
                                          />
                                        </Link>
                                      )) as ComponentChildren
                                  }
                                </dd>
                              </Fragment>
                            ),
                          )}
                        </dl>
                      ) : (
                        <table>
                          <tbody>
                            {Object.entries(
                              value as Record<string, unknown>,
                            ).map(([k, sectionValue]) => (
                              <tr key={k}>
                                <th>{k}</th>
                                <td
                                  class={
                                    typeof sectionValue === 'number'
                                      ? 'number'
                                      : ''
                                  }
                                >
                                  {sectionValue as ComponentChildren}
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
                </Fragment>
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
