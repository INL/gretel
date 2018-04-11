module.exports = {
    entry: './ts/main.ts',
    output: { filename: './js/ts/main.js' },
    resolve: {
        extensions: ['.ts', '.tsx', '.js']
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader'
            }
        ]
    },
    node: {
        fs: 'empty' // needed for the XPATH parser
    }
}
