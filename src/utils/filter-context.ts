import { createContext } from 'react';

const FilterContext = createContext<string | undefined>(undefined);
export default FilterContext;
