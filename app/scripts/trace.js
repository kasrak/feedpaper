const { all, run } = require("../src/main/db");

module.exports = function trace(targetFunction) {
    return async function (...args) {
        const functionName = targetFunction.name;
        const calledBy = new Error().stack.split("\n")[2].trim();

        const prevCall = await all(
            "SELECT * FROM trace WHERE function_name = $1 AND args = $2 ORDER BY id DESC LIMIT 1",
            [functionName, JSON.stringify(args)],
        );
        if (prevCall.length > 0) {
            const { output, error } = prevCall[0];
            if (!error) {
                // Cached result.
                return Promise.resolve(output);
            }
        }

        let output = null;
        let error = null;

        try {
            output = await targetFunction(...args);
        } catch (err) {
            error = err;
        }

        const sql = `
        INSERT INTO trace(function_name, args, output, called_by, error)
        VALUES ($1, $2, $3, $4, $5)
      `;

        const values = [
            functionName,
            JSON.stringify(args),
            output ? JSON.stringify(output) : null,
            calledBy,
            error
                ? JSON.stringify({
                      name: error.name,
                      message: error.message,
                  })
                : null,
        ];

        await run(sql, values);

        if (error) {
            throw error;
        }

        return output;
    };
};
