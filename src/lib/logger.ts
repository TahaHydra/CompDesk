import winston from 'winston';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'excodesk' },
    transports: [
        new winston.transports.Console({
            format:
                process.env.NODE_ENV === 'development'
                    ? winston.format.combine(winston.format.colorize(), winston.format.simple())
                    : winston.format.json(),
        }),
    ],
});

export default logger;
