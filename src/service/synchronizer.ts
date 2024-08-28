import { ServiceBusClient } from '@azure/service-bus';
import { Client as ElasticClient } from '@elastic/elasticsearch';
import { randomUUID } from 'crypto';

import { knexSnakeCaseMappers } from '../util/knexSnakeCaseMappers';
import knex from 'knex';

export const entitiesConfig = [
  {
    indexName: 'library',
    knex: null,
    database: 'uh_library',
    tableName: 'publications',
    sbSender: null,
    queueOrTopicName: 'sbt-library-publication-created',
    bodyFieldName: 'publication',
  },
  {
    indexName: 'organizations',
    knex: null,
    database: 'uh_organizations',
    tableName: 'organizations',
    sbSender: null,
    queueOrTopicName: 'sbq-organization-created',
    bodyFieldName: 'organization',
  },
  {
    indexName: 'cars',
    knex: null,
    database: 'uh_hunt',
    tableName: 'cars',
    sbSender: null,
    queueOrTopicName: 'sbt-car-created',
    bodyFieldName: 'car',
  },
];

let elasticClient = null;
let sbClient = null;

export const initialize = async () => {
  elasticClient = new ElasticClient({
    cloud: {
      id: process.env.ELASTIC_CLOUD_ID,
    },
    auth: {
      apiKey: process.env.ELASTIC_API_KEY,
    },
  });

  await Promise.all(
    entitiesConfig.map(async (config) => {
      config.knex = knex({
        client: 'pg',
        connection: {
          host: process.env.PG_HOST,
          port: Number(process.env.PG_PORT),
          user: process.env.PG_USERNAME,
          password: process.env.PG_PASSWORD,
          ssl: true,
          database: config.database,
        },
        pool: { min: 0, max: 5 },
        ...knexSnakeCaseMappers(),
      });
    }),
  );

  sbClient = new ServiceBusClient(process.env.SB_CONNECTION_STRING);

  entitiesConfig.forEach((config) => {
    config.sbSender = sbClient.createSender(
      `${config.queueOrTopicName}.${process.env.SB_POSTFIX}`,
    );
  });
};

export const clearIndices = async () => {
  console.log('Clearing indices...');
  for (const { indexName } of entitiesConfig) {
    try {
      const index = await elasticClient.indices.get({ index: indexName });
      const settings = index[indexName].settings;
      settings.index = Object.fromEntries(
        Object.entries(settings.index).filter(
          ([key]) =>
            !['uuid', 'provided_name', 'creation_date', 'version'].includes(
              key,
            ),
        ),
      );

      console.log(`Clearing "${indexName}"...`);
      await elasticClient.indices.delete({ index: indexName });
      await elasticClient.indices.create({
        index: indexName,
        aliases: index[indexName].aliases,
        mappings: index[indexName].mappings,
        settings,
      });
      console.log(`"${indexName}" cleared successfully!`);
    } catch (error) {
      console.error(error);
    }
  }
  console.log('Indices cleared!');
};

export const synchronizeIndices = async () => {
  console.log('Synchronizing indices...');
  for (const { knex, tableName, sbSender, bodyFieldName } of entitiesConfig) {
    try {
      const entities = await knex(tableName).select('*');
      console.log(entities.length);

      console.log(`Synchronizing "${tableName}"...`);
      for (const entity of entities) {
        const message = {
          body: { [bodyFieldName]: entity },
          contentType: 'application/json',
          messageId: randomUUID(),
        };
        await sbSender.sendMessages(message);
        console.log(`Message ${message.messageId} sent successfully!`);
      }
      console.log(`"${tableName}" synchronized successfully!`);
    } catch (error) {
      console.error(error);
    }
  }
  console.log('Indices synchronized!');
};

export const shutdown = async () => {
  for (const { knex, sbSender } of entitiesConfig) {
    if (knex) {
      await knex.destroy();
    }
    if (sbSender) {
      await sbSender.close();
    }
  }
  if (sbClient) {
    await sbClient.close();
  }
};
