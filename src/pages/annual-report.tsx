import './annual-report.css';

import { Trans } from '@lingui/react/macro';
import { Fragment, type ReactNode, type ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import Link from '../components/link';
import NameTextComponent from '../components/name-text';
import StatusComponent, {
  type StatusComponentProps,
} from '../components/status';
import { api, getMastoV1Resource } from '../utils/api';
import useTitle from '../utils/useTitle';

function NameText(props: {
  account?: unknown;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (event: React.SyntheticEvent) => void;
  [key: string]: unknown;
}) {
  return (
    <NameTextComponent
      {...(props as ComponentProps<typeof NameTextComponent>)}
    />
  );
}

function Status(props: {
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  showCommentCount?: boolean;
  [key: string]: unknown;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
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

interface AnnualReportsResource {
  $select(year: string): {
    fetch(): Promise<AnnualReportResponse>;
  };
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
    if (!year) return;
    const annualReports = getMastoV1Resource<AnnualReportsResource>(
      masto,
      'annualReports',
    );
    void (async () => {
      setUIState('loading');
      const fetched = await annualReports.$select(year).fetch();
      console.log('REPORT', fetched);
      setResults(fetched);
      setUIState('default');
    })();
  }, [year, masto]);

  const { accounts, annualReports, statuses } = results || {};
  const report = annualReports?.find((entry) => entry.year == year)?.data;

  const datePlaceholder = new Date();

  return (
    <div id="annual-report-page" className="deck-container" tabIndex={-1}>
      <div className={`report ${uiState === 'loading' ? 'loading-mask' : ''}`}>
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
                  <dd className={`report-${key}`}>
                    {Array.isArray(value) ? (
                      <table>
                        <thead>
                          <tr>
                            {Object.entries(
                              value[0] as Record<string, unknown>,
                            ).map(([colKey, colValue]) => (
                              <th
                                key={colKey}
                                className={
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
                                  className={
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
                                    (cellValue as ReactNode)
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
                                      )) as ReactNode
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
                                  className={
                                    typeof sectionValue === 'number'
                                      ? 'number'
                                      : ''
                                  }
                                >
                                  {sectionValue as ReactNode}
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
